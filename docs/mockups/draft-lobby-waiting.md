# Draft waiting state — design review

Static HTML in this folder. Open `draft-lobby-waiting.html` first.

**Matching:** `hub.room` · `frontend/src/DraftHub/DraftLobby.jsx`

These files are not product code. Do not ship them.

## The gap

Shipped Draft is a **setup** page: availability calendar, scheduled night, seats, nomination order, invite rail. That is the right page for the weeks before draft night. It is a dead hangout.

The request: a waiting state that is fun to sit in — chat, presence, order your board — and a way to get people into that room (invites + optional SMS).

## Phase model

| Phase | When | Surface |
|---|---|---|
| Setup | Until T–60, or until the commissioner opens the lobby | Today’s `DraftLobby` |
| Waiting | T–60 → start (or “Open lobby” with no schedule) | New hangout on the same Draft destination |
| Live | After start | Existing `DraftRoom` — board-first, no experience chrome |

Do not add a fourth Fantasy destination. Do not wrap the live room in lobby chrome.

One hour is the default open. Commissioner can start early from the waiting rail. If there is no scheduled night, the lobby does not auto-open.

## Concepts

| Id | Name | What leads | Pick this if |
|---|---|---|---|
| A | The Hour | Countdown + who’s here + on-page chat | The night is social. Recommended default. |
| B | War room | Private nomination queue | People already talk in the group text and want to set a board. |
| C | Check-in | “I’m here” + first-run SMS | Late arrivals are the pain and alerts need a landing moment. |

Recommendation if you want one ship: **A as the page**, B’s queue as a section, C’s check-in + SMS card in the rail.

## Invites (keep)

These already exist. Waiting-state does not replace them.

1. **Invite / claim link** — commissioner texts it; they create an account and pick a team.
2. **Member draft link** — people already on the league walk into the room.
3. **Email invite** — lock one seat to one address.
4. **Email managers** — becomes “Ping the room” (email everyone + SMS only if opted in).

SMS is **not** an invite channel. Do not collect a phone number on the claim form.

## Alerts (new, opt-in)

- Offer on **Draft** (member view) and **Account**.
- Checkbox starts **unchecked**. Consent sentence, STOP / HELP, rates.
- Number lives on the **account**, not the franchise. Per-league toggles can mute a room.
- First texts: lobby open, T–15, draft is live. “Your nomination” waits.
- No implied opt-in from email, Sleeper, or a pasted commissioner spreadsheet.
- Privacy + Terms must name phone and the SMS vendor before this ships.
- There is no phone field and no SMS vendor in the repo today.

## Hard lines from product

- Fun from consequence and rhythm, not confetti.
- Tokens only. Blue is *now* / *next*.
- Owner names lead. Team nicknames sit underneath.
- Chat stays `FantasyChatDock` plus an on-page log in the waiting phase — not an Office pane.
- Live draft audio remains opt-in. Do not add lobby sound.
