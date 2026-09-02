import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_VIBE_SLATE,
  VIBE_COPY,
  deckPlayers,
  espnHeadshotUrl,
  heroCopy,
} from "./vibeRankingsPresentation.js";

test("vibe copy names the goal and never says Draft Hub or Submit", () => {
  assert.match(VIBE_COPY.heading, /startable/i);
  assert.match(VIBE_COPY.support, /aura/i);
  assert.match(VIBE_COPY.swipeHint, /arrow/i);
  assert.match(VIBE_COPY.support, /matchup/i);
  assert.equal(VIBE_COPY.railTitle, "Vibe ranking");
  assert.equal(VIBE_COPY.slateTitle, "VA-projections");
  assert.match(VIBE_COPY.slateHint, /vibe-adjusted/i);
  assert.match(VIBE_COPY.support, /one read per player today/i);
  assert.match(VIBE_COPY.vsModelLine("Addison", "Metcalf"), /your vibe starts Addison/i);
  assert.match(VIBE_COPY.vsModelLine("Addison", "Metcalf"), /the board starts Metcalf/i);
  assert.doesNotMatch(VIBE_COPY.vsModelLine("Addison", "Metcalf"), /\bover\b/i);
  assert.doesNotMatch(VIBE_COPY.railTitle, /Your aura/i);
  assert.doesNotMatch(VIBE_COPY.slateTitle, /Vibe slate/i);
  assert.doesNotMatch(JSON.stringify(VIBE_COPY), /Draft Hub|Submit|permission|Tinder|Wikipedia/i);
});

test("empty and done heroes keep consequence copy", () => {
  const empty = heroCopy({ empty: true });
  assert.match(empty.heading, /roster/i);
  const done = heroCopy({ done: true });
  assert.match(done.heading, /Aura/i);
  assert.match(done.support, /This Week/);
});

test("week roster flattens starters and bench; demo slate has a startable week", () => {
  const rows = deckPlayers({
    roster: {
      starters: [{ player_id: "a", player_name: "A", position: "QB", p50: 20 }],
      bench: [{ player_id: "b", player_name: "B", position: "RB", p50: 12 }],
    },
  });
  assert.equal(rows.length, 2);
  assert.ok(DEMO_VIBE_SLATE.length >= 8);
  assert.ok(DEMO_VIBE_SLATE.some((row) => row.position === "K" && row.p50 > 0));
  assert.ok(DEMO_VIBE_SLATE.some((row) => row.position === "DEF" && row.p50 > 0));
  assert.ok(espnHeadshotUrl(3918298).includes("3918298"));
});
