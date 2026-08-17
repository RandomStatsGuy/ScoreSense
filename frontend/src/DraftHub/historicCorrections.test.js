import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CORRECTION_MODES,
  describeLivePreviewChange,
  formatPhase,
  formatSourceKind,
  historyOnlyLabel,
  moneyDelta,
  previewForwardLabel,
  salaryFieldUpdates,
} from "./historicCorrections.js";

test("salaryFieldUpdates maps cap and prior fields", () => {
  assert.deepEqual(salaryFieldUpdates("cap_hit", 55), {
    cap_hit: 55,
    base_salary: 55,
  });
  assert.deepEqual(salaryFieldUpdates("prior_salary", 12), { prior_salary: 12 });
  assert.deepEqual(salaryFieldUpdates("other", 1), {});
});

test("mode labels include season years", () => {
  assert.equal(historyOnlyLabel(2025), "2025 history only");
  assert.match(previewForwardLabel(2026), /2026/);
  assert.equal(CORRECTION_MODES.HISTORY_ONLY, "history_only");
});

test("format helpers humanize source and phase", () => {
  assert.equal(formatSourceKind("week1_sleeper"), "week1 sleeper");
  assert.equal(formatPhase("pre_draft"), "pre draft");
  assert.equal(formatPhase(""), "—");
});

test("moneyDelta detects meaningful salary changes", () => {
  assert.equal(moneyDelta(40, 40.001).changed, false);
  assert.equal(moneyDelta(40, 55).changed, true);
});

test("describeLivePreviewChange covers unmatched and changed cases", () => {
  assert.match(
    describeLivePreviewChange({ matched: false, message: "No match" }),
    /No match/,
  );
  assert.match(
    describeLivePreviewChange({
      matched: true,
      change: {
        player_name: "J. Chase",
        team_name: "Team A",
        before: 40,
        after: 55,
        changed: true,
      },
    }),
    /J\. Chase \(Team A\): \$40 → \$55/,
  );
  assert.match(
    describeLivePreviewChange({
      matched: true,
      change: { changed: false },
      message: "already matches",
    }),
    /already matches/,
  );
});
