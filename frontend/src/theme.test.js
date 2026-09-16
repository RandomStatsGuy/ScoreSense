import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
function boot(saved, blocked = false) {
  const html = { dataset: {}, style: {} };
  const events = {};
  let value = saved;
  let meta;
  const window = { addEventListener: (name, fn) => { events[name] = fn; } };
  vm.runInNewContext(source, {
    window,
    document: { documentElement: html, querySelector: () => ({ setAttribute: (_, v) => { meta = v; } }) },
    localStorage: {
      getItem: () => { if (blocked) throw Error("blocked"); return value; },
      setItem: (_, next) => { if (blocked) throw Error("blocked"); value = next; },
    },
  });
  return { theme: window.scoreSenseTheme, html, events, saved: () => value, meta: () => meta };
}
test("first paint restores a valid preference and defaults invalid/missing values to dark", () => {
  for (const saved of [null, "invalid", "dark", "light"]) {
    const app = boot(saved);
    const expected = saved === "light" ? "light" : "dark";
    assert.equal(app.html.dataset.theme, expected);
    assert.equal(app.html.style.colorScheme, expected);
    assert.equal(app.meta(), expected === "light" ? "#edf1f1" : "#070d17");
  }
});
test("toggle persists, notifies all controls, and unsubscribe stops notifications", () => {
  const app = boot(null);
  let calls = 0;
  const unsubscribe = app.theme.subscribe(() => calls++);
  app.theme.set("light");
  assert.equal(app.saved(), "light");
  assert.equal(app.theme.getSnapshot(), "light");
  assert.equal(calls, 1);
  unsubscribe();
  app.theme.set("dark");
  assert.equal(calls, 1);
  assert.equal(boot(app.saved()).theme.getSnapshot(), "dark");
});
test("blocked storage still allows switching for the current session", () => {
  const app = boot("light", true);
  app.theme.set("light");
  assert.equal(app.html.dataset.theme, "light");
});
test("other tabs synchronize changes and removal without reacting to unrelated keys", () => {
  const app = boot("dark");
  app.events.storage({ key: "scoresense-color-theme", newValue: "light" });
  assert.equal(app.theme.getSnapshot(), "light");
  app.events.storage({ key: "unrelated", newValue: "dark" });
  assert.equal(app.theme.getSnapshot(), "light");
  app.events.storage({ key: null, newValue: null });
  assert.equal(app.theme.getSnapshot(), "dark");
});
