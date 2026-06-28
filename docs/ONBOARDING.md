# ScoreSense onboarding & compliance

Persona flows, friction fixes, and production verification for auth email, legal links, and Draft Hub setup.

## Persona happy paths

### Patron (projections-only)

| Step | Action |
|------|--------|
| 1 | Land on `/projections/weekly` |
| 2 | Sign in via Patreon (production full-screen gate) |
| 3 | Browse Weekly / Season / Tools / Model |
| 4 | Optional: open League → solo workspace auto-created |

No forced Hub redirect.

### Solo drafter

| Step | Action |
|------|--------|
| 1 | Register, accept Terms/Privacy, verify email |
| 2 | League → `/hub/setup` |
| 3 | Stay on **Solo prep** |
| 4 | Configure **Rules** |
| 5 | Link **Sleeper** (optional) |
| 6 | **Spreadsheet import** if needed |
| 7 | **Players** / **Roster** for prep |

### Commissioner

| Step | Action |
|------|--------|
| 1–2 | Same auth as solo |
| 3 | Setup → **+ Create / join** → create league |
| 4 | Rules + pre/post-draft toggle |
| 5 | Sleeper + **Sync Sleeper** |
| 6 | **Invites & imports** → email managers |
| 7 | Import cap/league sheets if needed |
| 8 | **Draft** tab for live auction |

### Invited member

| Step | Action |
|------|--------|
| 1 | Open `/?invite={token}` from email |
| 2 | Register/sign in with **exact invited email** + verify if new |
| 3 | **Join league** |
| 4 | Setup → link Sleeper roster |
| 5 | Roster / Cap / Draft tabs |

## Friction matrix (before → after)

| Issue | Before | After |
|-------|--------|-------|
| Patreon callback drops `?invite=` | Lost deep link | OAuth `state` preserves `next` path |
| Auth callback URL | Stripped to `/` | `/auth/callback?token=&next=` |
| Invite SMTP on failure | Possible 500 after DB write | `email_sent: false`, invite still saved |
| SMTP on VPS | Undocumented | `deploy/env.production.example` + DEPLOY.md |
| Register consent | None | Required checkbox + DB timestamp |
| Auth emails | None | Verify, welcome, password reset |
| Hub unverified users | Full access | Blocked until verified (native accounts) |
| Legal / disclaimers | TODO in docs | In-app `/terms` + `/privacy` + product disclaimers |
| Account self-service | None | `/account` — change password, profile, delete |
| Setup guidance | Manual sections only | Dismissible checklist on Setup |

## Production verification checklist

1. **SMTP on VPS** — set `SMTP_*` in server `.env` (never deployed from repo). Send a league invite; API returns `email_sent: true`.
2. **Register** — checkbox required; verification email arrives; link hits `/api/auth/verify-email` → `/auth/verify?success=1`; welcome email sent.
3. **Forgot password** — `/auth/forgot-password` or AccountAuth link → reset email → `/auth/reset-password?token=`.
4. **Account settings** — `/account` while signed in: change password, update display name, resend verification, delete test account (league data may remain).
5. **Legal pages** — `/terms` and `/privacy` load without login (also reachable from register checkbox).
6. **Invite + Patreon** — open `/?invite=token`, Patreon login, return to invite modal with token intact.
7. **Disclaimers** — visible on projections subtitle, Props, DFS, Best Ball.
8. **Unverified native user** — projections OK when `AUTH_REQUIRED=false` locally; Hub shows verify banner / blocks API until verified.
9. **Terms version bump** — set `TERMS_VERSION` on server; native users see re-accept banner until they accept.
10. **Tests** — `pytest tests/test_auth_accounts.py tests/test_hub_league_invites.py -q`

## Env vars (summary)

See `.env.example` and `deploy/env.production.example`:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS`
- `TERMS_URL`, `PRIVACY_URL` (optional — default to in-app pages via `FRONTEND_URL`)
- `TERMS_VERSION`
- `FRONTEND_URL` (must match public app URL for email links)

## API routes added

| Route | Purpose |
|-------|---------|
| `GET /api/auth/verify-email?token=` | Confirm email, redirect to frontend |
| `POST /api/auth/resend-verification` | Resend verify email (rate limited) |
| `POST /api/auth/forgot-password` | Send reset link (rate limited) |
| `POST /api/auth/reset-password` | Set new password via email token |
| `POST /api/auth/change-password` | Change password while logged in (native) |
| `PATCH /api/auth/profile` | Update display name (native) |
| `POST /api/auth/accept-terms` | Re-accept after `TERMS_VERSION` bump |
| `POST /api/auth/delete-account` | Delete native login (Hub data may remain) |
| `GET /api/auth/patreon/login?next=` | OAuth with return path in signed state |

Register body requires `accept_terms: true`.

Frontend routes: `/terms`, `/privacy`, `/account`, `/auth/forgot-password`, `/auth/reset-password`.
