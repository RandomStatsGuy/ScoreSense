import assert from "node:assert/strict";
import test from "node:test";

import {
  actionLabel,
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
