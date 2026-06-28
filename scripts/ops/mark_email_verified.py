#!/usr/bin/env python3
"""Mark a native account email as verified (ops). Usage: python scripts/ops/mark_email_verified.py user@example.com"""

from __future__ import annotations

import sys

from src.auth import user_store


def main() -> int:
    email = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if not email:
        print("Usage: python scripts/ops/mark_email_verified.py EMAIL", file=sys.stderr)
        return 1
    row = user_store.get_user_by_email(email)
    if not row:
        print(f"NOT_FOUND: {email}")
        return 1
    updated = user_store.mark_email_verified(row["id"])
    print(f"VERIFIED: {updated['email'] if updated else email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
