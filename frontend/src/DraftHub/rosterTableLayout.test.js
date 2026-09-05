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
  assert.match(table, /table-layout:\s*fixed/);

  for (const cls of [
    "hub-roster-col-player",
    "hub-roster-col-pos",
    "num hub-roster-col-cap",
    "num hub-roster-col-years",
    "hub-roster-col-status",
    "hub-roster-actions",
  ]) {
    assert.match(rosterBuilder, new RegExp(`<th[^>]*className="${cls}"`));
    assert.match(rosterBuilder, new RegExp(`<td[^>]*className="${cls}"`));
  }
  assert.match(rosterBuilder, /<th className="hub-roster-actions">Contract<\/th>/);
});

test("League Rosters columns declare a shared header/body layout", () => {
  const table = block(".hub-roster-browser-page .hub-roster-table");
  assert.match(table, /table-layout:\s*fixed/);

  for (const cls of [
    "hub-roster-col-player",
    "hub-roster-col-pos",
    "num hub-roster-col-cap",
    "num hub-roster-col-years",
    "hub-roster-col-type",
    "hub-roster-col-contract",
    "hub-roster-actions",
  ]) {
    assert.match(rosterBrowser, new RegExp(`<th[^>]*className="${cls}"`));
    assert.match(rosterBrowser, new RegExp(`<td[^>]*className="${cls}"`));
  }
  assert.doesNotMatch(rosterBrowser, /hub-roster-col-pts/);
  assert.doesNotMatch(rosterBrowser, /Pts \/\$/);
});

test("League Rosters player and action cells keep a measured gap", () => {
  const playerLine = block(".hub-roster-player-line");
  assert.match(playerLine, /display:\s*flex/);
  assert.match(playerLine, /gap:\s*0\.5rem/);

  const expire = block(".hub-roster-player-stack .hub-expire-chip");
  assert.match(expire, /margin-left:\s*0/);

  const actions = block(".hub-roster-action-group");
  assert.match(actions, /display:\s*inline-flex/);
  assert.match(actions, /flex-wrap:\s*nowrap/);
  assert.match(actions, /white-space:\s*nowrap/);
  assert.match(actions, /gap:\s*0\.35rem 0\.55rem/);
  assert.match(rosterBrowser, /className="hub-roster-action-group"/);
});
