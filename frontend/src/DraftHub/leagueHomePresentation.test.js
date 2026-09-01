import assert from "node:assert/strict";
import test from "node:test";

import {
  actionLabel,
  formatHomeScore,
  HOME_DECK_COPY,
  homeDeckStandingRows,
  homeMatchupNote,
  phaseTrackState,
  resolveLeagueHomeFocus,
  supportingLeagueHomeActions,
} from "./leagueHomePresentation.js";

const validViews = new Set(["planner", "roster", "room", "week", "value"]);

test("league home promotes the highest-priority actionable item over the phase CTA", () => {
  const expiring = {
    id: "expiring_contracts",
    message: "Review 8 expiring contracts",
    href: "roster",
  };
  const focus = resolveLeagueHomeFocus({
    actions: [expiring],
    primaryCta: { label: "Draft plan", view: "value" },
    validViews,
  });

  assert.equal(focus.kind, "action");
  assert.equal(focus.title, "Review 8 expiring contracts");
  assert.equal(focus.label, "Review contracts");
  assert.equal(focus.view, "roster");
});

test("league home falls back to the phase CTA when there is nothing urgent", () => {
  const focus = resolveLeagueHomeFocus({
    actions: [],
    primaryCta: { label: "Draft plan", view: "value" },
    validViews,
  });

  assert.equal(focus.kind, "phase");
  assert.equal(focus.title, "You’re clear for now");
  assert.equal(focus.label, "Draft plan");
  assert.equal(focus.view, "value");
});

test("supporting actions omit the item already promoted into the hero", () => {
  const first = { id: "cap_overage", href: "planner" };
  const second = { id: "expiring_contracts", href: "roster" };
  const focus = resolveLeagueHomeFocus({ actions: [first, second], validViews });

  assert.deepEqual(supportingLeagueHomeActions([first, second], focus), [second]);
});

test("phase track marks exactly one current phase", () => {
  const track = phaseTrackState("live_draft");
  assert.equal(track.filter((item) => item.current).length, 1);
  assert.equal(track.find((item) => item.current)?.label, "Draft");
});

test("known action labels use concrete verbs", () => {
  assert.equal(actionLabel({ id: "cap_overage" }), "Fix cap");
  assert.equal(actionLabel({ id: "lineup_decisions" }), "Set lineup");
});

test("home deck helpers format empty scores and keep the viewer in standings", () => {
  assert.equal(formatHomeScore({ points: 0 }, true), "—");
  assert.equal(formatHomeScore({ points: 84.2 }, false), "84.2");
  const rows = homeDeckStandingRows(
    [
      { roster_id: "1", hub_team_id: "a", rank: 1, team_name: "A", wins: 0, losses: 0 },
      { roster_id: "2", hub_team_id: "b", rank: 2, team_name: "B", wins: 0, losses: 0 },
      { roster_id: "3", hub_team_id: "c", rank: 3, team_name: "C", wins: 0, losses: 0 },
      { roster_id: "4", hub_team_id: "d", rank: 4, team_name: "D", wins: 0, losses: 0 },
      { roster_id: "5", hub_team_id: "e", rank: 5, team_name: "E", wins: 0, losses: 0 },
      { roster_id: "6", hub_team_id: "you", rank: 6, team_name: "You", wins: 0, losses: 0 },
    ],
    "you",
    5,
  );
  assert.equal(rows.length, 5);
  assert.equal(rows[4].hub_team_id, "you");
  assert.equal(
    homeMatchupNote({ placeholder: true, week: 3 }, { roster_id: "tbd", team_name: "Opponent TBD" }),
    "Week 3 opponent TBD",
  );
  assert.equal(HOME_DECK_COPY.linkSleeper, "Link Sleeper to fill scores.");
});
