import assert from "node:assert/strict";
import test from "node:test";
import { NOMINATION_COPY, nominationModeLabel, nominationRailEmpty } from "./draftNominationPresentation.js";

test("Need vs Tax copy names leftover without Draft Hub or Submit", () => {
  assert.equal(NOMINATION_COPY.need, "Need");
  assert.equal(NOMINATION_COPY.tax, "Tax");
  assert.match(NOMINATION_COPY.taxLine({ owner: "Alex", leftover: 88, pos: "TE" }), /Alex has \$88 at TE/);
  assert.doesNotMatch(JSON.stringify(NOMINATION_COPY), /Draft Hub|Submit|poison|permission/i);
  assert.equal(nominationModeLabel("tax"), "Tax");
  assert.equal(nominationModeLabel("need"), "Need");
});

test("Need empty names leftover as the reason", () => {
  assert.match(
    nominationRailEmpty({ mode: "need", leftover: 0, needPositions: ["QB"] }),
    /leftover/i,
  );
  assert.match(
    nominationRailEmpty({
      mode: "need",
      leftover: 40,
      needPositions: ["QB"],
      hasNeedWithoutLeftover: true,
    }),
    /leftover/i,
  );
  assert.match(
    nominationRailEmpty({ mode: "need", needPositions: ["TE"] }),
    /Needs filled/i,
  );
});

test("Need empty does not call leftover broke when a filter emptied the rail", () => {
  assert.match(
    nominationRailEmpty({
      mode: "need",
      leftover: 100,
      needPositions: ["QB"],
      search: "zzz",
    }),
    /filters/i,
  );
  assert.match(
    nominationRailEmpty({
      mode: "need",
      leftover: 100,
      needPositions: ["QB"],
      position: "WR",
    }),
    /filters/i,
  );
  assert.match(
    nominationRailEmpty({ mode: "need", leftover: 100, needPositions: ["QB"] }),
    /Needs filled/i,
  );
});
