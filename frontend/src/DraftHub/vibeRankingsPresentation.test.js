import assert from "node:assert/strict";
import test from "node:test";
import { WEEK_BOARD_COPY } from "./weekBoard.js";
import {
  DEMO_VIBE_SLATE,
  VIBE_COPY,
  deckPlayers,
  emptySlotCta,
  emptySlotName,
  espnHeadshotUrl,
  heroCopy,
  hottestLabel,
  rateHint,
  vsModelNote,
  vsSplitRows,
} from "./vibeRankingsPresentation.js";

test("vibe copy names the goal and never says Draft Hub or Submit", () => {
  assert.match(VIBE_COPY.heading, /start or sit/i);
  assert.match(VIBE_COPY.support, /aura/i);
  assert.match(VIBE_COPY.support, /the board/i);
  assert.doesNotMatch(VIBE_COPY.support, /site board/i);
  assert.match(VIBE_COPY.support, /Skip a card/i);
  assert.equal(VIBE_COPY.railTitle, "Vibe ranking");
  assert.equal(VIBE_COPY.slateTitle, "VA-projections");
  assert.match(VIBE_COPY.slateHint, /board number/i);
  assert.match(VIBE_COPY.heading, /once today/i);
  assert.equal(VIBE_COPY.vsYours, "Your vibe");
  assert.equal(VIBE_COPY.vsBoard, "The board");
  assert.equal(VIBE_COPY.moreLabel, "Bio");
  assert.match(VIBE_COPY.openMoreNamed("Justin Jefferson"), /Justin Jefferson/);
  assert.match(VIBE_COPY.openMoreNamed("Justin Jefferson"), /Open bio/);
  assert.doesNotMatch(VIBE_COPY.openMore, /profile|arrow/i);
  assert.doesNotMatch(VIBE_COPY.swipeHint, /arrow|profile/i);
  assert.doesNotMatch(VIBE_COPY.desktopHint, /swipe/i);
  assert.doesNotMatch(VIBE_COPY.railTitle, /Your aura/i);
  assert.doesNotMatch(VIBE_COPY.slateTitle, /Vibe slate/i);
  assert.doesNotMatch(JSON.stringify(VIBE_COPY), /Draft Hub|Submit|permission|Tinder|Wikipedia|site board/i);
});

test("desktop hint is one instruction line; phone names swipe and bio", () => {
  assert.match(rateHint({ coarse: false }), /Sit or Start/i);
  assert.match(rateHint({ coarse: false }), /Open bio/i);
  assert.match(rateHint({ coarse: false }), /Backspace/i);
  assert.doesNotMatch(rateHint({ coarse: false }), /swipe/i);
  assert.match(rateHint({ coarse: true }), /swipe/i);
  assert.match(rateHint({ coarse: true }), /Open bio/i);
});

test("empty slots share This Week's Empty string and Find POS CTA", () => {
  assert.equal(emptySlotName("K"), "Empty");
  assert.equal(emptySlotName("DEF"), "Empty");
  assert.equal(emptySlotCta("K"), WEEK_BOARD_COPY.emptySlot("K"));
  assert.equal(emptySlotCta("DEF"), WEEK_BOARD_COPY.emptySlot("DEF"));
  assert.equal(WEEK_BOARD_COPY.emptySlotName, "Empty");
});

test("week vs vibe vs board table helpers stay scannable", () => {
  const rows = vsSplitRows([
    {
      start: { player_id: "a", player_name: "Addison", p50: 10 },
      sit: { player_id: "b", player_name: "Metcalf", p50: 12 },
    },
  ], { a: 99 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].yoursName, "Addison");
  assert.equal(rows[0].boardName, "Metcalf");
  assert.ok(rows[0].delta !== 0);
  assert.match(vsModelNote({ ratedToday: 0, pairCount: 0 }), /empty until a vibe disagrees/i);
  assert.match(vsModelNote({ ratedToday: 0, pairCount: 3 }), /have not rated today/i);
  assert.match(vsModelNote({ ratedToday: 2, pairCount: 1 }), /board's week/i);
});

test("hottest names the week tiebreak when aura ties", () => {
  const tied = hottestLabel([
    { player: { player_name: "Jonathan Taylor", p50: 15.9 }, aura: 99 },
    { player: { player_name: "Jayden Daniels", p50: 8.3 }, aura: 99 },
  ]);
  assert.match(tied, /Jonathan Taylor/);
  assert.match(tied, /99/);
  assert.match(tied, /15\.9 week/);
  assert.match(tied, /tiebreak/i);
  assert.equal(hottestLabel([]), "—");
});

test("empty and done heroes keep consequence copy and drop the fake chip", () => {
  const empty = heroCopy({ empty: true });
  assert.match(empty.heading, /roster/i);
  assert.equal(empty.chip, "");
  const live = heroCopy();
  assert.equal(live.chip, "");
  const done = heroCopy({ done: true });
  assert.match(done.heading, /reads are in/i);
  assert.match(done.support, /This Week/);
  assert.equal(done.chip, "");
  const demo = heroCopy({ demo: true });
  assert.equal(demo.chip, VIBE_COPY.chipDemo);
  assert.equal(demo.chipTone, "readonly");
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
