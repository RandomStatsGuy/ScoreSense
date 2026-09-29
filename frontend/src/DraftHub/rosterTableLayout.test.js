import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../styles/fantasy.css"), "utf8");

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

// Approved My team A uses a flat list; scripts/dev/my_team_check.mjs tests rendered alignment and controls.

// League Rosters now has a different approved layout. Its filtering and missing-data
// behavior is covered in rosterBoard.test.js; rendered alignment and actions are
// exercised by scripts/dev/rosters_browser.mjs.
