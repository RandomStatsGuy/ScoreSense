# Chat A review

Approved A replaces the edge launcher and side drawer with a detached bubble and a centered conversation. Holding the bubble reveals its X; hiding removes it entirely, and Notification settings restores it. League and staff conversations, private direct messages, mentions, reactions, unread counts, and preference-controlled on-site alerts use the shared conversation components.

## Review images

| Phone | Desktop |
| --- | --- |
| [Conversation](390-chat.png) | [Conversation](1280-chat.png) |
| [Closed bubble](390-bubble.png) | [Light theme](1280-chat-light.png) |
| [Notification settings](390-settings.png) | |
| [Notifications](390-notifications.png) | |

Screenshots use isolated sample messages. They do not post messages to the local league.

## Validation

Backend and static checks: 81 passed. Chat presentation and authentication tests pass. The focused registry suite retains one unrelated My team description failure, reproduced against unchanged develop. Full frontend suite: 932 passed, three existing failures (auction contract label, accuracy copy, My team living-surface description). Production build passes.

Exact PR build browser interactions and chat/notification/settings layout checks pass at 320, 390 and 1280px. The compact header keeps the bell on its first row.

`verification.json` records the coverage and limitations. The page-wide audit JSON files were captured in the original workspace; existing button, table, and page hierarchy issues remain outside this change. Full active live auction and production deployment were not checked. Compact draft chat and regular-member permissions were checked with the source fixture before branch isolation and with backend tests.

## Repeat browser checks

With the existing API on port 8000 and Vite on 5173, run `node scripts/dev/fantasy_chat_browser.mjs` from the repository root. The script intercepts only communication mutations and leaves the local league unchanged. To inspect a built PR without another server, build the frontend, set `FANTASY_CHAT_DIST` to the absolute `frontend/dist` directory, then run the same script. It serves built UI assets through Playwright routes while using the existing local API. Home integration and source-only compact/member fixtures are skipped in this mode; use the matching development checkout for those checks.
