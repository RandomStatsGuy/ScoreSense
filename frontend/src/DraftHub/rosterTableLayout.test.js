import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../styles.css"), "utf8");
const rosterBuilder = readFileSync(join(here, "RosterBuilder.jsx"), "utf8");

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
});
