"""增幅名稱：客戶端沒有翻譯的增幅（nameTRA 是「…_BlankName」佔位字串或空的）不能把內部代號顯示在畫面上。"""
import unittest

import lcu


class AugmentNameTests(unittest.TestCase):
    def test_translated_name_is_kept(self):
        self.assertEqual(lcu._augment_name({"id": 3170, "augmentNameId": "GoH_PentakillAug_HeavyMetal", "nameTRA": "重金屬"}), "重金屬")

    def test_placeholder_uses_fallback(self):
        a = {"id": 3176, "augmentNameId": "GoH_PentakillAug_Generic", "nameTRA": "GoH_PentakillAug_Generic_BlankName"}
        self.assertEqual(lcu._augment_name(a), "殺五社（金屬套裝效果）")

    def test_unknown_placeholder_is_still_chinese(self):
        for name in ("", None, "Foo_BlankName", "Foo"):
            self.assertEqual(lcu._augment_name({"id": 9, "augmentNameId": "Foo", "nameTRA": name}), "未命名增幅（9）")


if __name__ == "__main__":
    unittest.main()
