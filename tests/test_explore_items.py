import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app


class ExploreItemsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.file = Path(tmp.name) / ".explore_items.json"
        for name, value in (("EXPLORE_FILE", self.file), ("PUBLIC", False)):
            patcher = mock.patch.object(app, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.request = mock.Mock()

    def save(self, **kw):
        body = app.ExploreItemBody(**{"kind": "card", "name": "測試", "spec": {"rows": ["champions.name"]}, **kw})
        return app.save_explore_item(body, self.request)

    def test_missing_or_broken_file_is_empty(self):
        self.assertEqual(app.explore_items(), [])
        self.file.write_text("{not json", encoding="utf-8")
        self.assertEqual(app.explore_items(), [])

    def test_save_then_list_then_update_in_place(self):
        first = self.save()["item"]
        self.assertEqual(app.list_explore_items(self.request)["items"], [first])
        second = self.save(id=first["id"], name="改名")["item"]
        items = app.explore_items()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "改名")
        self.assertEqual(second["id"], first["id"])

    def test_rejects_bad_kind_empty_name_and_oversize(self):
        self.assertEqual(self.save(kind="script").status_code, 400)
        self.assertEqual(self.save(name="   ").status_code, 400)
        self.assertEqual(self.save(name="x" * 61).status_code, 400)
        self.assertEqual(self.save(spec={"blob": "x" * (app.EXPLORE_MAX_BYTES + 1)}).status_code, 400)
        self.assertEqual(self.save(id="../etc").status_code, 400)
        self.assertEqual(app.explore_items(), [])

    def test_kind_cannot_change_on_update(self):
        card = self.save()["item"]
        self.assertEqual(self.save(id=card["id"], kind="board").status_code, 400)

    def test_item_limit(self):
        with mock.patch.object(app, "EXPLORE_MAX_ITEMS", 2):
            self.save(); self.save()
            self.assertEqual(self.save().status_code, 400)

    def test_delete(self):
        item = self.save()["item"]
        self.assertEqual(app.delete_explore_item("nope", self.request).status_code, 404)
        self.assertEqual(app.delete_explore_item(item["id"], self.request), {"ok": True})
        self.assertEqual(app.explore_items(), [])

    def test_non_admin_can_read_but_not_write(self):
        item = self.save()["item"]
        with mock.patch.object(app, "_is_admin", return_value=False):
            listed = app.list_explore_items(self.request)
            self.assertEqual(listed, {"items": [item], "canEdit": False})
            self.assertEqual(self.save().status_code, 403)
            self.assertEqual(app.delete_explore_item(item["id"], self.request).status_code, 403)
        self.assertEqual(len(app.explore_items()), 1)

    def test_file_ignores_foreign_entries(self):
        self.file.write_text(json.dumps({"items": [{"kind": "card", "id": "a"}, {"kind": "evil"}, "junk"]}), encoding="utf-8")
        self.assertEqual([i["id"] for i in app.explore_items()], ["a"])


if __name__ == "__main__":
    unittest.main()
