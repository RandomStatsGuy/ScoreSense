import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), "utf8");

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : "";
}

test("projections board panels stretch so a wide phone row cannot push the page sideways", () => {
  const css = read("styles/projections-experience.css");
  assert.match(rule(css, ".projections-board"), /align-items:\s*stretch/);
});

test("phone card hero puts the sub line under the value instead of beside it", () => {
  const css = read("styles/fantasy-phone.css");
  assert.match(rule(css, ".mobile-player-card-hero"), /display:\s*grid/);
  assert.match(rule(css, ".mobile-player-card-hero-sub"), /grid-column:\s*1\s*\/\s*-1/);
  assert.doesNotMatch(rule(css, ".mobile-player-card-hero"), /flex-direction:\s*row/);
});

test("compare picking hides the weekly phone range and the expand chevron", () => {
  const weekly = read("WeeklyTable.jsx");
  assert.match(weekly, /heroSub=\{compareSelecting \? null :/);
  assert.match(weekly, /reserveHeroSub=\{!compareSelecting\}/);
  const card = read("MobilePlayerCard.jsx");
  assert.match(card, /hasExpand && !tapSelects \?/);
});
