import test from "node:test";
import assert from "node:assert/strict";
import {
  AUCTION_COLUMN_IDS,
  columnsForDraftMode,
  pickDraftSchemaHasNoAuctionColumns,
  PICK_DRAFT_SORT_OPTIONS,
  sortLabelForKey,
} from "./valueSheetColumns.js";

test("pick-draft live console schema has no auction columns", () => {
  const schema = columnsForDraftMode({
    pickDraft: true,
    compact: true,
    advanced: false,
    draftConsole: true,
    showDelta: false,
    showStatus: false,
    showAdd: false,
    showSelect: true,
  });
  assert.equal(pickDraftSchemaHasNoAuctionColumns(schema), true);
  assert.equal(schema.showFairValue, false);
  assert.equal(schema.showCostDelta, false);
  assert.equal(schema.showValueRange, false);
  assert.equal(schema.showTier, false);
  assert.equal(schema.showSalaryBounds, false);
  assert.equal(schema.showPosRank, true);
  assert.equal(schema.showNeed, true);
  assert.equal(schema.actionCol, true);
  assert.deepEqual(schema.ids, ["player", "season_proj", "pos_rank", "need", "actions"]);
  assert.equal(schema.colCount, schema.ids.length);
  assert.equal(schema.colCount, 5);
  assert.ok(!schema.sortOptions.some((o) => o.id === "fair_value" || o.id === "value_delta"));
  assert.ok(PICK_DRAFT_SORT_OPTIONS.some((o) => o.id === "season_proj"));
});

test("pick-draft advanced schema keeps projection risk without dollars", () => {
  const schema = columnsForDraftMode({
    pickDraft: true,
    compact: false,
    advanced: true,
    draftConsole: false,
    showStatus: true,
    showAdd: true,
  });
  assert.equal(pickDraftSchemaHasNoAuctionColumns(schema), true);
  assert.equal(schema.showP10, true);
  assert.equal(schema.showSpread, true);
  assert.equal(schema.showFairValue, false);
  assert.ok(!schema.ids.includes("tier"));
});

test("auction schema retains bid, range, and value vs cost", () => {
  const schema = columnsForDraftMode({
    pickDraft: false,
    compact: true,
    advanced: false,
    draftConsole: true,
    showDelta: true,
    showStatus: false,
    showAdd: false,
    showSelect: true,
  });
  assert.equal(schema.showFairValue, true);
  assert.equal(schema.showValueRange, true);
  assert.equal(schema.showCostDelta, true);
  assert.equal(schema.showTier, true);
  assert.ok(schema.ids.includes("fair_value"));
  assert.ok(AUCTION_COLUMN_IDS.some((id) => schema.ids.includes(id)));
  assert.equal(schema.colCount, schema.ids.length);
  assert.ok(schema.sortOptions.some((o) => o.id === "fair_value"));
});

test("loading/empty colCount matches populated schema", () => {
  const live = columnsForDraftMode({ pickDraft: true, compact: true, draftConsole: true, showStatus: false, showSelect: true });
  const empty = columnsForDraftMode({ pickDraft: true, compact: true, draftConsole: true, showStatus: false, showSelect: true });
  assert.equal(live.colCount, empty.colCount);
});

test("available board folds tier and hides empty vs-cost", () => {
  const schema = columnsForDraftMode({
    pickDraft: false,
    compact: false,
    advanced: false,
    draftConsole: false,
    showDelta: false,
    showStatus: false,
    showAdd: true,
    foldTier: true,
  });
  assert.equal(schema.showTier, false);
  assert.equal(schema.showCostDelta, false);
  assert.equal(schema.actionCol, true);
  assert.ok(!schema.ids.includes("tier"));
  assert.ok(!schema.ids.includes("value_delta"));
  assert.ok(schema.ids.includes("actions"));
  assert.equal(schema.columns.find((c) => c.id === "season_proj")?.label, "Season pts");
});

test("sort labels stay human-readable in compact and mobile summaries", () => {
  assert.equal(sortLabelForKey(PICK_DRAFT_SORT_OPTIONS, "season_proj"), "Season points");
  assert.equal(sortLabelForKey([], "season_spread"), "Season Spread");
});
