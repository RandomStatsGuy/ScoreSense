"""Create mobile mock shells and fingerprint their local CSS/JS before previewing.

Run from the repo root (PYTHONPATH=.):
  python scripts/dev/mobile_mock.py create fantasy-week-a --destination "This Week"
  python scripts/dev/mobile_mock.py stamp docs/mockups/fantasy-week-a.html
"""
import argparse
from hashlib import sha256
from html import escape
from pathlib import Path
import re
from string import Template
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

MOCKS = Path(__file__).resolve().parents[2] / "docs" / "mockups"
ASSET_TAG = re.compile(r"<(?:link|script)\b[^>]*>", re.IGNORECASE)
ASSET_URL = re.compile(r"\b(?:href|src)=(['\"])(.*?)\1", re.IGNORECASE)


def fingerprint_html(html, page):
    """Version direct local CSS/JS dependencies; leave navigation/remote URLs alone."""
    def tag(match):
        def asset(attribute):
            url = urlsplit(attribute.group(2))
            if url.scheme or url.netloc or Path(url.path).suffix not in (".css", ".js"):
                return attribute.group(0)
            path = (page.parent / url.path).resolve()
            path.relative_to(MOCKS)  # A preview must not reference files outside its root.
            digest = sha256(path.read_bytes()).hexdigest()[:12]
            query = [(key, value) for key, value in parse_qsl(url.query) if key != "v"]
            query.append(("v", digest))
            versioned = urlunsplit(("", "", url.path, urlencode(query), url.fragment))
            return attribute.group(0).replace(attribute.group(2), versioned)
        return ASSET_URL.sub(asset, match.group(0))
    return ASSET_TAG.sub(tag, html)


def stamp(page):
    page = page.resolve()
    page.relative_to(MOCKS)
    html = page.read_text(encoding="utf-8")
    updated = fingerprint_html(html, page)
    if updated != html:
        page.write_bytes(updated.encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="Create a new shell; existing files are preserved")
    create.add_argument("slug", help="Output filename without .html, e.g. fantasy-week-a")
    create.add_argument("--destination", required=True)
    create.add_argument("--league", default="Bottom to Top")
    create.add_argument("--title", help="Preview title outside the app chrome")
    refresh = commands.add_parser("stamp", help="Refresh versions after editing CSS or JS")
    refresh.add_argument("pages", nargs="+", type=Path)
    args = parser.parse_args()
    if args.command == "stamp":
        for page in args.pages:
            stamp(page)
            print("Versioned " + str(page))
        return
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.slug):
        parser.error("Use a lowercase hyphenated slug.")
    page = MOCKS / (args.slug + ".html")
    if page.exists():
        parser.error(str(page) + " already exists; edit it and use stamp.")
    values = {
        "destination": escape(args.destination, quote=True),
        "league": escape(args.league, quote=True),
        "title": escape(args.title or (args.destination + " · Mobile preview"), quote=True),
    }
    template = Template((MOCKS / "_mobile-starter.html").read_text(encoding="utf-8"))
    page.write_bytes(fingerprint_html(template.substitute(values), page).encode("utf-8"))
    print("Created " + str(page))


if __name__ == "__main__":
    main()
