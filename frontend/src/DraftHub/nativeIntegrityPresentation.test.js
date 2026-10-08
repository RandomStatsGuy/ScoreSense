import assert from "node:assert/strict";
import test from "node:test";
import { canEditHubLineup, lineupPlayerLocked, lineupPlayerLock, lineupCallAction, WEEK_BOARD_COPY } from "./weekBoard.js";
import { duelRows, nativeScoreRefreshMessage, nativeScoreRefreshVariant, LEAGUE_SCORING_CONTROL_COPY } from "./gameCenterPresentation.js";
import { mergeLeagueRules, snapshotRulesForm, validateLeagueSettings } from "./rulesPresentation.js";
import { scoringAwardsForFormat } from "./insights/insightsPresentation.js";
import { PLAYERS_TAB_COPY } from "./acquisitionWindow.js";

test("native edits lock started and unknown kickoff players while future games stay open", () => {
  assert.equal(lineupPlayerLocked({ kickoff_available: false }), true);
  assert.equal(lineupPlayerLock({ lock_reason: "kickoff_unavailable" }), WEEK_BOARD_COPY.kickoffUnavailable);
  assert.equal(lineupCallAction({ canEdit: true, bench: { lineup_locked: true } }).kind, "locked");
  assert.equal(lineupPlayerLocked({ kickoff_et: "2026-10-05T00:00:00Z" }, { now: Date.parse("2026-10-06T00:00:00Z") }), true);
  assert.equal(lineupPlayerLocked({ kickoff_et: "2026-10-07T00:00:00Z" }, { now: Date.parse("2026-10-06T00:00:00Z") }), false);
  assert.equal(canEditHubLineup({ mode: "league", lineupSource: "hub", lineupLocked: true, isCommissioner: true }), false);
  assert.equal(canEditHubLineup({ mode: "league", lineupSource: "hub", lineupLocked: false, weekScored: true }), true);
});

test("configured empty K and DEF slots persist and explicit native slots pair by identity", () => {
  const rows = duelRows({ starters: [{ name: "Defense", player_id: "DAL", slot: "DEF", position: "DEF" }, { name: "Kicker", player_id: "k", slot: "K", position: "K" }] }, { starters: [] }, ["QB", "K", "DEF"]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].home, null);
  assert.equal(rows[1].home.name, "Kicker");
  assert.equal(rows[2].home.name, "Defense");
  assert.equal(rows.every(row => row.away == null), true);
});

test("incomplete score coverage produces truthful pending and error notices", () => {
  assert.equal(nativeScoreRefreshMessage({ scoring_status: "pending" }), LEAGUE_SCORING_CONTROL_COPY.pending);
  assert.equal(nativeScoreRefreshVariant({ scoring_status: "error" }), "warn");
  assert.equal(nativeScoreRefreshMessage({ scoring_errors: ["Historical starting lineups are missing"] }), LEAGUE_SCORING_CONTROL_COPY.missingLineups);
});

test("schedule-only and playoff-only changes affect dirty tracking and validation", () => {
  const rules = mergeLeagueRules({});
  const base = { name: "League", season: 2026, rules };
  assert.notEqual(snapshotRulesForm(base), snapshotRulesForm({ ...base, rules: { ...rules, regular_season_games: 13 } }));
  assert.notEqual(snapshotRulesForm(base), snapshotRulesForm({ ...base, rules: { ...rules, playoffs: { ...rules.playoffs, enabled: true, teams: 4 } } }));
  assert.equal(validateLeagueSettings({ ...base, rules: { ...rules, playoffs: { ...rules.playoffs, enabled: true, start_week: 18 } } }).playoff_start != null, true);
  assert.equal(validateLeagueSettings({ ...base, rules: { ...rules, playoffs: { enabled: true, teams: 4, start_week: 15 } } }).playoff_start, undefined);
});

test("pick Insights exclude monetary scoring awards and instant salary copy states canonical fee", () => {
  const awards = [{ id: "points_king" }, { id: "cap_efficiency_goat" }];
  assert.deepEqual(scoringAwardsForFormat(awards, false), [awards[0]]);
  assert.deepEqual(scoringAwardsForFormat(awards, true), awards);
  assert.match(PLAYERS_TAB_COPY.addSalaryEffect(99), /\$1.*one-year/);
  assert.match(PLAYERS_TAB_COPY.howAddsBody, /priority claims/);
});
