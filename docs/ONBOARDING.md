# ScoreSense onboarding & compliance

Persona flows, friction fixes, and production verification for auth email, legal links, and Fantasy setup.

User-facing product area is **Fantasy** (routes still live under `/hub/*`). Names and chrome: [PRODUCT.md](./PRODUCT.md).

## Persona happy paths

### Patron (projections-only)

| Step | Action |
|------|--------|
| 1 | Land on `/projections/weekly` |
| 2 | Sign in via Patreon (production full-screen gate) |
| 3 | Browse Weekly / Season / Tools / Model accuracy |
| 4 | Optional: open Fantasy → solo workspace auto-created |

No forced Fantasy redirect.

### Solo drafter

| Step | Action |
|------|--------|
| 1 | Register, accept Terms/Privacy, verify email |
| 2 | Fantasy → `/hub/setup` |
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
| 6 | **Draft** → copy the invite link and text the group |
| 7 | Optional: **Roster management → Access** for email-to-one-team invites |
| 8 | Import cap/league sheets if needed |
| 9 | **Draft** tab for availability + live auction |

### Invited member

Screen-by-screen for the group text (claim link → pick a team → mark nights): [INVITE_FLOW.md](./INVITE_FLOW.md).

| Step | Action |
|------|--------|
| 1 | Open `/hub/draft?invite={token}` from email (`/?invite=` still works), or `/hub/draft?claim={token}` from a text |
| 2 | Register/sign in (email invites still require the invited address) |
| 3 | **Claim your team** (or Join league on an email invite). If they created an account and skipped this, staff can attach the login in **Admin → Leagues → Link existing account**. |
| 4 | **Draft** → mark nights that work when the calendar is open |
| 5 | Setup → link Sleeper roster |
| 6 | Roster / Cap / Draft tabs |

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
5. **Legal pages** — `/terms`, `/privacy`, and `/sms-alerts` load without login (also reachable from register checkbox). Privacy must name Twilio, say mobile numbers are not shared for marketing, note message frequency, and include “message and data rates may apply.” `/sms-alerts` is the public A2P opt-in card.
6. **Invite + Patreon** — open `/hub/draft?invite=token` or `/hub/draft?claim=token`, Patreon login, return to the join modal on Draft with the token intact.
7. **Disclaimers** — visible on projections subtitle, Props, DFS, Best Ball.
8. **Unverified native user** — projections OK when `AUTH_REQUIRED=false` locally; Hub shows verify banner / blocks API until verified.
9. **Terms version bump** — set `TERMS_VERSION` on server; native users see re-accept banner until they accept.
10. **Tests** — `pytest tests/test_auth_accounts.py tests/test_hub_league_invites.py -q`

## Env vars (summary)

See `.env.example` and `deploy/env.production.example`:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (optional — Continue with Google)
- `TERMS_URL`, `PRIVACY_URL` (optional — default to in-app pages via `FRONTEND_URL`)
- `TERMS_VERSION`
- `FRONTEND_URL` (must match public app URL for email links)
- `JIRA_EMAIL`, `JIRA_API_TOKEN` (optional — Account → Report a bug files a SCORE Bug; without them the form says the board is closed)

## Report a bug

`/report` is an account-menu side option, not a product area. Signed-in reports become SCORE Jira Bugs with labels `user-reported` and `pickup`. Board access and pickup JQL are below.

## Outside collaborators (GitHub + Jira)

Give a pickup person **just enough** to take `user-reported` tickets. Do not share the VPS, `.env`, or the Jira API token the app uses.

### Jira (`scoresenseapp.atlassian.net`, project SCORE)

SCORE is a team-managed software project. Invite them as a **site User** with **Jira** product access, then add them to SCORE as a **Member**.

They need:

- Browse the SCORE board
- See issues (including `labels = user-reported`)
- Assign a ticket to themselves
- Transition Backlog → In Progress → Done
- Comment

They should **not** have: Organization admin, Jira product admin, SCORE Administrator, delete issues, or the `JIRA_API_TOKEN` that files reports.

Pickup JQL:

`project = SCORE AND labels = user-reported AND statusCategory != Done ORDER BY created DESC`

Board URL: `https://scoresenseapp.atlassian.net/jira/software/c/projects/SCORE/issues/?jql=project%20%3D%20SCORE%20AND%20labels%20%3D%20user-reported%20AND%20statusCategory%20!%3D%20Done%20ORDER%20BY%20created%20DESC`

### GitHub (`RandomStatsGuy/ScoreSense`)

The repo is public. A fork + PR works with **no** GitHub permission.

For a trusted friend, invite them as a **collaborator with Write**:

- Push a branch and open a PR
- Be assigned a GitHub issue if you still use those

They should **not** have: Admin, Maintain, Actions secrets, deploy keys, or merge to `master`. PRs target **`develop`**. You review.

### What they should read first

`docs/PRODUCT.md` — user-facing name is Fantasy, not Draft Hub. Copy lives in `*Presentation.js`. Do not add a fourth top-level area.

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
| `GET /api/auth/google/login?next=` | Google OAuth with return path in signed state |
| `GET /api/auth/google/callback` | Google OAuth callback → `/auth/callback` |
| `GET /api/support/bugs/status` | Whether Report a bug can file to SCORE |
| `POST /api/support/bugs` | Signed-in user report → SCORE Bug (`user-reported`, `pickup`) |

Register body requires `accept_terms: true`.

Frontend routes: `/login`, `/register`, `/signup`, `/terms`, `/privacy`, `/account`, `/auth/forgot-password`, `/auth/reset-password`.
