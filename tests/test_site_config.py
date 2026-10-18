import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app


class SiteDefaultsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.file = Path(tmp.name) / ".site_config.json"
        patcher = mock.patch.object(app, "SITE_CONFIG_FILE", self.file)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_missing_file_uses_builtin_defaults(self):
        self.assertEqual(app.site_defaults(), {"queue": "2400", "dateRange": "all", "versionFrom": None})

    def test_bad_values_fall_back_one_by_one(self):
        self.file.write_text(json.dumps({"defaults": {
            "queue": "420", "dateRange": "last 30 days", "versionFrom": "16.17; DROP"}}), encoding="utf-8")
        self.assertEqual(app.site_defaults(), {"queue": "2400", "dateRange": "last 30 days", "versionFrom": None})

    def test_all_modes_and_version_from_are_kept(self):
        self.file.write_text(json.dumps({"defaults": {"queue": None, "dateRange": "last 7 days", "versionFrom": "16.18"}}),
                             encoding="utf-8")
        self.assertEqual(app.site_defaults(), {"queue": None, "dateRange": "last 7 days", "versionFrom": "16.18"})

    def test_broken_json_does_not_raise(self):
        self.file.write_text("{not json", encoding="utf-8")
        self.assertEqual(app.site_defaults()["dateRange"], "all")


class AdminTests(unittest.TestCase):
    def check(self, public, session, admins):
        with mock.patch.object(app, "PUBLIC", public), \
             mock.patch.object(app, "_session", return_value=session), \
             mock.patch.object(app, "oauth_config", return_value={"admins": admins}):
            return app._is_admin(mock.Mock())

    def test_local_is_always_admin(self):
        self.assertTrue(self.check(False, None, []))

    def test_mirror_needs_listed_discord_user(self):
        listed = {"discord_id": "111", "username": "owner", "name": "O"}
        other = {"discord_id": "222", "username": "friend", "name": "F"}
        self.assertTrue(self.check(True, listed, ["111"]))
        self.assertTrue(self.check(True, listed, ["Owner"]))  # 使用者名稱不分大小寫
        self.assertFalse(self.check(True, other, ["111"]))
        self.assertFalse(self.check(True, None, ["111"]))

    def test_shared_password_login_is_never_admin(self):
        self.assertFalse(self.check(True, {"discord_id": None, "username": None, "name": "密碼登入"}, ["111"]))


if __name__ == "__main__":
    unittest.main()
