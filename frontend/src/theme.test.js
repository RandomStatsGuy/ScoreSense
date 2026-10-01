import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
function boot(saved, blocked = false, appearanceSaved = null, osLight = false) {
  const html = { dataset: {}, style: {} };
  const events = {};
  const values = { "scoresense-color-theme": saved, "scoresense-appearance": appearanceSaved };
  const media = { matches: osLight, addEventListener: (_, fn) => { events.device = fn; } };
  let meta;
  const window = { addEventListener: (name, fn) => { events[name] = fn; }, matchMedia: () => media };
  vm.runInNewContext(source, {
    window,
    document: { documentElement: html, querySelector: () => ({ setAttribute: (_, v) => { meta = v; } }) },
    localStorage: {
      getItem: (key) => { if (blocked) throw Error("blocked"); return values[key] ?? null; },
      setItem: (key, next) => { if (blocked) throw Error("blocked"); values[key] = next; },
    },
  });
  return { theme: window.scoreSenseTheme, appearance: window.scoreSenseAppearance, html, events, media, saved: () => values["scoresense-color-theme"], meta: () => meta };
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

test("System follows device changes; explicit modes stay fixed", () => {
  const app = boot("system", false, null, true);
  assert.equal(app.theme.getPreference(), "system");
  assert.equal(app.theme.getSnapshot(), "light");
  app.media.matches = false;
  app.events.device();
  assert.equal(app.theme.getSnapshot(), "dark");
  app.theme.set("light");
  app.events.device();
  assert.equal(app.theme.getSnapshot(), "light");
  app.theme.set("system");
  assert.equal(app.theme.getSnapshot(), "dark");
});

test("appearance restores the palette before paint, independently of scene switches", () => {
  const app = boot("light", false, JSON.stringify({ atmosphere: "cozy", atmosphere_enabled: false, atmosphere_motion: false }));
  assert.equal(app.html.dataset.experienceTheme, "cozy");
  assert.equal(app.meta(), "#f4e5de");
  assert.equal(app.appearance.getSnapshot().atmosphere_enabled, false);
  app.theme.set("dark");
  assert.equal(app.html.dataset.experienceTheme, "cozy");
  assert.equal(app.meta(), "#241c2d");
});

test("appearance cache rejects malformed themes and synchronizes across tabs", () => {
  for (const saved of ["not JSON", "[]", '{"atmosphere":"unknown"}']) {
    assert.equal(boot("dark", false, saved).html.dataset.experienceTheme, "none");
  }
  const app = boot("dark");
  let calls = 0;
  const unsubscribe = app.appearance.subscribe(() => calls++);
  const optimistic = app.appearance.set({ atmosphere: "snow", atmosphere_enabled: false });
  assert.equal(optimistic, app.appearance.getSnapshot());
  assert.equal(app.meta(), "#102645");
  app.events.storage({ key: "scoresense-appearance", newValue: '{"atmosphere":"leaves"}' });
  assert.equal(app.html.dataset.experienceTheme, "leaves");
  assert.equal(calls, 2);
  unsubscribe();
  app.events.storage({ key: "scoresense-appearance", newValue: null });
  assert.equal(app.html.dataset.experienceTheme, "none");
  assert.equal(calls, 2);
  const blocked = boot("dark", true);
  blocked.appearance.set({ atmosphere: "cozy" });
  assert.equal(blocked.html.dataset.experienceTheme, "cozy");
});
