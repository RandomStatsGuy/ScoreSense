import assert from "node:assert/strict";
import test from "node:test";

import {
  actionLabel,
  formatHomeScore,
  HOME_DECK_COPY,
  HOME_PAGE_COPY,
  homeDeckMode,
  homeDeckStandingRows,
  homeHasPendingCuts,
  homeAlsoDueMessage,
  homeHeroHeading,
  homeHeroSupport,
  homeMatchupNote,
  homeStandingHasGap,
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
  assert.equal(focus.title, "Nothing is due.");
  assert.equal(focus.label, "Draft plan");
  assert.equal(focus.view, "value");
});

test("supporting actions omit the item already promoted into the hero", () => {
  const first = { id: "cap_overage", href: "planner" };
  const second = { id: "expiring_contracts", href: "roster" };
  const focus = resolveLeagueHomeFocus({ actions: [first, second], validViews });

  assert.deepEqual(supportingLeagueHomeActions([first, second], focus), [second]);
});

test("supporting actions drop null entries so Also due cannot crash", () => {
  const first = { id: "cap_overage", href: "planner" };
  assert.deepEqual(supportingLeagueHomeActions([null, first, undefined], { action: null }), [first]);
});

test("phase track marks exactly one current phase", () => {
  const track = phaseTrackState("live_draft");
  assert.equal(track.filter((item) => item.current).length, 1);
  assert.equal(track.find((item) => item.current)?.label, "Draft");
});

test("home heading names the next move, not a command-center slogan", () => {
  assert.match(HOME_PAGE_COPY.heading, /seats|lock a night/i);
  assert.equal(HOME_PAGE_COPY.supportingTitle, "Also due");
  assert.equal(HOME_PAGE_COPY.notScheduled, "Not scheduled");
  assert.doesNotMatch(HOME_PAGE_COPY.heading, /command center|decision count|Do the next league move/i);
  assert.equal(
    homeHeroHeading({ actions: [{ id: "invite_managers" }], seating: { open_seats: 11 } }),
    "Fill 11 seats, then lock a night.",
  );
  assert.equal(homeHeroSupport({ seating: { open_seats: 11 } }), HOME_PAGE_COPY.emptySeatsCost);
});

test("Also due uses the same extend and expiring nouns as My team", () => {
  assert.equal(
    homeAlsoDueMessage({
      id: "expiring_contracts",
      message: "Review 7 expiring contracts",
      meta: { must_extend: 2, dropping_at_draft: 5 },
    }),
    "2 to extend · 5 expiring",
  );
});

test("known action labels use concrete verbs", () => {
  assert.equal(actionLabel({ id: "cap_overage" }), "Fix cap");
  assert.equal(actionLabel({ id: "lineup_decisions" }), "Set lineup");
  assert.equal(actionLabel({ id: "invite_managers" }), "Invite managers");
  assert.equal(actionLabel({ id: "mark_availability" }), "Mark times");
  assert.equal(actionLabel({ id: "roster_hole" }), "Open draft room");
});

test("home hero names the roster hole over empty seats", () => {
  const hole = {
    id: "roster_hole",
    message: "You draft with 0 RBs under contract. $178 to spend.",
    href: "room",
  };
  const invite = { id: "invite_managers", message: "Invite 9 managers to claim a team", href: "room" };
  const focus = resolveLeagueHomeFocus({
    actions: [hole, invite],
    primaryCta: { label: "Draft plan", view: "value" },
    validViews,
  });
  assert.equal(focus.id, "roster_hole");
  assert.equal(focus.label, "Open draft room");
  assert.equal(supportingLeagueHomeActions([hole, invite], focus)[0].id, "invite_managers");
  assert.equal(
    homeHeroHeading({ actions: [hole, invite], seating: { open_seats: 9 } }),
    hole.message,
  );
  assert.match(homeHeroSupport({ actions: [hole] }), /wasted nomination|Undo a cut/i);
  assert.equal(homeHasPendingCuts({ pre_draft: { pending_cuts_count: 1 } }), true);
  assert.equal(HOME_PAGE_COPY.undoCut, "Undo a cut");
  assert.match(HOME_PAGE_COPY.loadingFallback, /Still syncing with Sleeper/i);
  assert.equal(HOME_PAGE_COPY.loadingHeading, "Checking what is due…");
  assert.equal(HOME_PAGE_COPY.loadingKicker, "Reading your league");
});

test("pre-draft home hides an unscored matchup deck", () => {
  assert.deepEqual(
    homeDeckMode({ phaseId: "pre_draft", draftCompleted: false, scoring: { placeholder: true } }),
    { show: false, historical: false },
  );
  assert.deepEqual(
    homeDeckMode({
      phaseId: "pre_draft",
      draftCompleted: false,
      scoring: { placeholder: false, standings: [{ rank: 1 }], week: 1 },
    }),
    { show: true, historical: true },
  );
  assert.deepEqual(
    homeDeckMode({
      phaseId: "pre_draft",
      draftCompleted: false,
      scoring: {
        placeholder: true,
        standings: [{ rank: 8, wins: 4, losses: 10, hub_team_id: "you" }],
      },
    }),
    { show: true, historical: true },
  );
  assert.equal(HOME_PAGE_COPY.lastSeason, "Last season");
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
  assert.equal(homeStandingHasGap({ rank: 4 }, { rank: 10 }), true);
  assert.equal(homeStandingHasGap({ rank: 3 }, { rank: 4 }), false);
  assert.equal(HOME_DECK_COPY.clearChat, "Clear chat");
  assert.equal(HOME_DECK_COPY.lockerTitle, "League chat");
  assert.match(HOME_DECK_COPY.lockerNote, /follows you/i);
  assert.doesNotMatch(HOME_DECK_COPY.lockerNote, /Draft Hub|Submit|permission/i);
});
