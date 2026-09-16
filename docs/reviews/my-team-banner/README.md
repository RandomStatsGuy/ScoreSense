# My Team banner cleanup

My Team reuses Game center's faded saved team banner and crop in the matchup scoreboard. Manage roster uses a compact identity/cap summary without a stadium banner; appearance editing remains available.

## Visual checks

Screenshots use deterministic fixtures and were captured during implementation before rebasing the isolated PR onto develop. Production league data and deployment were not checked.

| Surface | 1280 | 390 |
| --- | --- | --- |
| My Team Room | PASS | PASS |
| Manage roster | PASS | PASS |
| Game center | PASS | PASS |

The browser checks exercised room/team/week selection, roster/contract navigation, nicknames, sharing, read-only, empty, and error states. The isolated PR build and 47 targeted tests pass after rebasing.

## Screenshots

| View | Desktop | Phone |
| --- | --- | --- |
| Room | [1280](my-team-room-1280.png) | [390](my-team-room-390.png) |
| Manage roster | [1280](my-team-manage-1280.png) | [390](my-team-manage-390.png) |
