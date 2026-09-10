import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../styles.css"), "utf8");
const rosterBuilder = readFileSync(join(here, "RosterBuilder.jsx"), "utf8");
const rosterBrowser = readFileSync(join(here, "LeagueRostersBrowser.jsx"), "utf8");

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `expected CSS rule for ${selector}`);
  return match[1];
}

test("roster table action cells stay table-cells so header and body share a grid", () => {
  const tableActions = block(".hub-roster-table .hub-roster-actions");
  assert.match(tableActions, /display:\s*table-cell/);
  assert.match(tableActions, /vertical-align:\s*middle/);

  const listActions = block(".hub-roster-row .hub-roster-actions");
  assert.match(listActions, /display:\s*flex/);
});

test("My Team roster columns declare a shared header/body layout", () => {
  const table = block(".hub-roster-builder .hub-roster-table");
  assert.match(table, /table-layout:\s*auto/);

  for (const cls of [
    "hub-roster-col-player",
    "hub-roster-col-pos",
    "hub-roster-actions",
  ]) {
    assert.match(rosterBuilder, new RegExp(`<th[^>]*className="${cls}"`));
    assert.match(rosterBuilder, new RegExp(`<td[^>]*className="${cls}"`));
  }
  for (const cls of [
    "num hub-roster-col-cap",
    "num hub-roster-col-years",
    "hub-roster-col-status",
  ]) {
    assert.match(rosterBuilder, new RegExp(`<SortTh[^>]*className="${cls}"`));
    assert.match(rosterBuilder, new RegExp(`<td[^>]*className="${cls}"`));
  }
  assert.match(rosterBuilder, /<th className="hub-roster-actions">Contract<\/th>/);
});

// League Rosters now has a different approved layout. Its filtering and missing-data
// behavior is covered in rosterBoard.test.js; rendered alignment and actions are
// exercised by scripts/dev/rosters_browser.mjs.
