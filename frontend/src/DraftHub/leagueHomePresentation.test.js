import assert from "node:assert/strict";
import test from "node:test";

import {
  actionLabel,
  phaseTrackState,
  pulseEventLine,
  resolveLeagueHomeFocus,
  supportingLeagueHomeActions,
} from "./leagueHomePresentation.js";

test("pulse events read as human league activity", () => {
  assert.deepEqual(
    pulseEventLine({ kind: "cut", player_name: "S. Tucker", from_owner: "Stephen P", dead_cap: 1 }),
    { icon: "−", text: "Stephen P cut S. Tucker ($1 dead)." },
  );
  assert.deepEqual(
    pulseEventLine({ kind: "waiver", player_name: "Rico Dowdle", to_owner: "Disappointment", salary: 7 }),
    { icon: "+", text: "Disappointment won Rico Dowdle on waivers at $7." },
  );
  assert.deepEqual(
    pulseEventLine({
      kind: "trade",
      team_a: "Panda Fraud",
      team_b: "Thanks noob noob",
      players_a: ["Breece Hall"],
      players_b: ["Jayden Reed"],
    }),
    { icon: "⇄", text: "Panda Fraud ⇄ Thanks noob noob completed a trade — Breece Hall, Jayden Reed." },
  );
  assert.equal(
    pulseEventLine({ kind: "trade_in", player_name: "DK Metcalf", to_owner: "Panda Command", from_owner: "Daddio" }).text,
    "DK Metcalf moved from Daddio to Panda Command by trade.",
  );
  // Unknown kinds degrade to a neutral line instead of crashing the feed.
  assert.equal(pulseEventLine({ kind: "mystery", player_name: "X" }).icon, "•");
});

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
