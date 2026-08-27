import test from "node:test";
import assert from "node:assert/strict";
import {
  playersTabAddLabel,
  playersTabAddMode,
  playersTabBanner,
  playerTradeableInWindow,
  tradesWindowBanner,
} from "./acquisitionWindow.js";

test("solo prep uses instant add", () => {
  assert.equal(playersTabAddMode(null, { inLeague: false }), "add");
});

test("league without a window stays locked", () => {
  assert.equal(playersTabAddMode(null, { inLeague: true }), "locked");
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
