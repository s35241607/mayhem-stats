import tempfile
import unittest
from pathlib import Path
from unittest import mock

import app


class ClassifyLogLineTests(unittest.TestCase):
    def test_kinds(self):
        cases = {
            "2026-10-28 19:00:00 429 cube/load who=s-ab layer=session retry=3s": "429",
            "2026-10-28 19:00:01 GET /api/cube/load 200 12ms who=Lan": "query",
            "2026-10-28 19:00:02 GET /api/match/TW2/1 500 3ms who=anon": "error",
            "登入成功: Lan (id 1) 透過 Discord": "login",
            "Traceback (most recent call last):": "error",
            "Started server process [27288]": "other",
        }
        for text, kind in cases.items():
            with self.subTest(text=text):
                self.assertEqual(app._classify_log_line(text), kind)


class ReadLogTailTests(unittest.TestCase):
    def test_reads_whole_small_file_and_skips_missing(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "x.log"
        path.write_text("a\nb\nc\n", encoding="utf-8")
        self.assertEqual(app._read_log_tail(path), ["a", "b", "c"])
        self.assertEqual(app._read_log_tail(Path(tmp.name) / "missing.log"), [])

    def test_large_file_drops_partial_first_line(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "big.log"
        path.write_bytes(b"x" * 100 + b"\nlast-1\nlast-2\n")
        with mock.patch.object(app, "LOG_TAIL_BYTES", 16):
            lines = app._read_log_tail(path)
        self.assertEqual(lines, ["last-1", "last-2"])


if __name__ == "__main__":
    unittest.main()
