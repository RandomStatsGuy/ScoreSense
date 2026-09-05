import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYERS_TAB_COPY,
  playersTabAddDisabledReason,
  playersTabAddLabel,
  playersTabAddMode,
  playersTabBanner,
  playersTabLockedChip,
  playersTabStarCopy,
  playerTradeableInWindow,
  tradesWindowBanner,
} from "./acquisitionWindow.js";

test("solo prep uses instant add", () => {
  assert.equal(playersTabAddMode(null, { inLeague: false }), "add");
});

test("league without a window stays locked", () => {
  assert.equal(playersTabAddMode(null, { inLeague: true }), "locked");
  const chip = playersTabLockedChip();
  assert.equal(chip.label, "Locked");
  assert.equal(playersTabAddDisabledReason("locked"), PLAYERS_TAB_COPY.lockedReason);
  assert.match(chip.popover, /Adds open after the draft/i);
  assert.equal(playersTabStarCopy(false), "Star for draft");
  assert.equal(playersTabStarCopy(true), "Starred for draft");
});

test("free agents copy names the add and the cost of waiting", () => {
  assert.match(PLAYERS_TAB_COPY.lockedReason, /after the draft/i);
  assert.match(PLAYERS_TAB_COPY.howAddsBody, /calendar|draft|Bid or Add/i);
  assert.doesNotMatch(PLAYERS_TAB_COPY.howAddsBody, /Submit|Draft Hub|permission/i);
  assert.equal(PLAYERS_TAB_COPY.seasonPts, "Season pts");
});

test("waiver window uses bid copy", () => {
  assert.equal(playersTabAddMode({ add_mode: "bid" }, { inLeague: true }), "bid");
  assert.equal(playersTabAddLabel("bid"), "Bid");
  const banner = playersTabBanner({ add_mode: "bid", message: "Place a bid.", label: "Waiver bidding" });
  assert.equal(banner.variant, "warn");
});

test("offseason surviving-contract trades skip one-year deals", () => {
  const window = { trade_scope: "surviving_contracts", add_mode: "locked", label: "Offseason" };
  assert.equal(playerTradeableInWindow({ contract_years: 2 }, window), true);
  assert.equal(playerTradeableInWindow({ contract_years: 1 }, window), false);
  assert.equal(
    playerTradeableInWindow({ contract_years: 1, contract: { pending_extension: { years: 2 } } }, window),
    true,
  );
  const banner = tradesWindowBanner(window);
  assert.equal(banner.variant, "info");
});
