import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APP_SECTIONS, SKIP_TO_CONTENT } from "./appNavigation.js";

test("bottom nav uses the full Projections word", () => {
  const projections = APP_SECTIONS.find((item) => item.id === "projections");
  assert.equal(projections.label, "Projections");
  assert.equal(projections.shortLabel, "Projections");
  assert.deepEqual(
    APP_SECTIONS.map((item) => item.shortLabel),
    ["Projections", "Fantasy", "Tools"],
  );
});

test("app keeps one main landmark for the skip link", () => {
  const src = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("./layout/MobileShell.jsx", import.meta.url), "utf8");
  assert.equal(SKIP_TO_CONTENT, "Skip to content");
  assert.equal([...src.matchAll(/<main\b/g)].length, 1);
  assert.equal([...src.matchAll(/<\/main>/g)].length, 1);
  assert.match(src, /<main id="main-content" className="app-main"/);
  assert.match(src, /className="app-skip-link"/);
  assert.doesNotMatch(src, /id="app-main"/);
  assert.doesNotMatch(shell, /skip-link|#main-content/);
});
