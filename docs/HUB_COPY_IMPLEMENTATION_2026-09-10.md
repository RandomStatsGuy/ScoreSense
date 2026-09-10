# Hub copy implementation — September 10, 2026

Implements the copy review against `develop` (baseline `cd2c025`). The original review describes production observations; this change applies to the components present on develop.

## Changes

- Rewrites introductions and supporting text across Home, Strategy, Draft, This Week, Vibes, Game center, My team, Free agents, Rosters, Cap, Trades, Rules, roster management, and Insights.
- Names actions by their immediate effect: ranking preferences, draft queue replacement, lineup review/save, contract cuts, and removal without a cap penalty.
- Uses clearer cap, projection, contract, and team terminology. Describes estimates without promising results or predicting another manager's behavior.
- Removes fabricated first-person player bios and demo player commentary. Marks sample news as demo examples.
- Separates an empty Game center lineup from unavailable data and a populated matchup before kickoff. Suppresses selected Insights empty messages during loading/errors.
- Provides a downloadable TSV cap-sheet template and explains roster replacement before import.
- Makes three DraftSeat component imports explicit so Windows does not resolve them to the separate draftSeat helper module.

## Validation

- Vite production build passes (existing bundle-size warnings remain).
- Frontend and layout helper suite: 724 passed, 2 failed, 726 total. Includes new regression cases for Game center states and missing profile facts.
- Both failures reproduce on untouched develop: the availability callback source-pattern assertion in `draftAvailabilityPresentation.test.js`, and the missing-value accuracy note assertion in `accuracyPresentation.test.js`.
- Ran test files explicitly with Node because the package's `node --test src` command does not discover them on the installed Node 24 runtime.
- Authenticated interactive states were not exercised against this branch. Verify responsive layouts and consequential actions in staging before deployment.

## Follow-up investigations from the review

This PR does not establish the causes of production discrepancies between roster sources, free-agent eligibility, cap totals, player tiers/valuations, or historical name aliases. Those require data and behavior investigation. It does not add a new scoring-profile control, change valuation calculations, or normalize historical records. The wording describes the existing develop behavior; it does not claim those discrepancies are resolved.
