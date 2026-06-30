#!/usr/bin/env python3
from src.auth import user_store
for u in user_store.list_users(limit=50):
    print(u.get("email"), u.get("display_name"), u.get("email_verified_at"))
