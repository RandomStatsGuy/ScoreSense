"""Guard the stale-asset failure that broke the approved mobile preview."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.dev import mobile_mock


class MobileMockTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.override = patch.object(mobile_mock, "MOCKS", self.root)
        self.override.start()
        self.addCleanup(self.override.stop)

    def test_shared_style_change_updates_its_url_without_changing_page_or_script(self):
        css = self.root / "foundation.css"
        css.write_text("summary { display: list-item; }", encoding="utf-8")
        (self.root / "preview.js").write_text("// preview", encoding="utf-8")
        page = self.root / "page.html"
        html = '<link rel="stylesheet" href="foundation.css?theme=dark"><script src="preview.js"></script>'
        first = mobile_mock.fingerprint_html(html, page)
        self.assertEqual(mobile_mock.fingerprint_html(first, page), first)
        css.write_text("summary { display: grid; }", encoding="utf-8")
        second = mobile_mock.fingerprint_html(first, page)
        self.assertNotEqual(first.split("<script")[0], second.split("<script")[0])
        self.assertEqual(first.split("<script")[1], second.split("<script")[1])
        self.assertIn("theme=dark", second)
        self.assertEqual(second.count("v="), 2)

    def test_navigation_and_external_assets_are_untouched(self):
        html = '<a href="other.html">Page</a><script src="https://example.com/a.js"></script>'
        self.assertEqual(mobile_mock.fingerprint_html(html, self.root / "page.html"), html)

    def test_missing_dependency_fails_before_saving_the_page(self):
        page = self.root / "page.html"
        html = '<link rel="stylesheet" href="missing.css">'
        page.write_text(html, encoding="utf-8")
        with self.assertRaises(FileNotFoundError):
            mobile_mock.stamp(page)
        self.assertEqual(page.read_text(encoding="utf-8"), html)

    def test_mock_assets_cannot_escape_the_preview_root(self):
        with self.assertRaises(ValueError):
            mobile_mock.fingerprint_html('<script src="../outside.js"></script>', self.root / "page.html")


if __name__ == "__main__":
    unittest.main()
