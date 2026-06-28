#!/usr/bin/env python3
"""One-off: print auth user row by email (argv[1])."""
from __future__ import annotations

import sys

from src.auth import user_store


def main() -> None:
    email = sys.argv[1] if len(sys.argv) > 1 else ""
    row = user_store.get_user_by_email(email)
    if not row:
        print("NOT_FOUND")
        return
    print("email", row.get("email"))
    print("id", row.get("id"))
    print("verified", user_store.is_email_verified(row))
    print("email_verified_at", row.get("email_verified_at"))


if __name__ == "__main__":
    main()
