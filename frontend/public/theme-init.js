// Restore both choices before CSS/React loads. Color mode remains browser-local;
// the appearance cache restores account-saved themes without a reload flash.
(() => {
  const key = "scoresense-color-theme";
  const appearanceKey = "scoresense-appearance";
  const appearanceListeners = new Set();
  const listeners = new Set();
  const normalize = (value) => ["light", "system"].includes(value) ? value : "dark";
  const themes = ["none", "cozy", "snow", "leaves", "footballs", "kickoff", "redzone", "press"];
  const read = (name) => { try { return localStorage.getItem(name); } catch { return null; } };
  const normalizeAppearance = (value) => Object.freeze({
    ...(value && typeof value === "object" && !Array.isArray(value) ? value : {}),
    atmosphere: themes.includes(value?.atmosphere) ? value.atmosphere : "none",
  });
  const parseAppearance = (value) => { try { return normalizeAppearance(JSON.parse(value)); } catch { return normalizeAppearance(null); } };
  const media = window.matchMedia?.("(prefers-color-scheme: light)");
  let preference = normalize(read(key));
  let appearance = parseAppearance(read(appearanceKey));
  const canvases = {
    none: { light: "#edf1f1", dark: "#070d17" },
    cozy: { light: "#f6e4dc", dark: "#1e1528" },
    snow: { light: "#d8eef7", dark: "#0a1d36" },
    leaves: { light: "#f5dec4", dark: "#241318" },
    footballs: { light: "#efe5d4", dark: "#17120d" },
    kickoff: { light: "#e1efe8", dark: "#081715" },
    redzone: { light: "#f2e4e4", dark: "#1c0f13" },
    press: { light: "#f0e8d8", dark: "#16151a" },
  };
  let current = "dark";
  function apply(value) {
    preference = normalize(value);
    current = preference === "system" ? (media?.matches ? "light" : "dark") : preference;
    const canvas = canvases[appearance.atmosphere][current];
    document.documentElement.dataset.theme = current;
    document.documentElement.dataset.experienceTheme = appearance.atmosphere;
    document.documentElement.style.colorScheme = current;
    document.documentElement.style.backgroundColor = canvas;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", canvas);
    listeners.forEach((listener) => listener());
  }
  window.scoreSenseTheme = Object.freeze({
    getSnapshot: () => current,
    getPreference: () => preference,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (value) => {
      const next = normalize(value);
      try { localStorage.setItem(key, next); } catch { /* Keep the in-session choice working. */ }
      apply(next);
    },
  });
  function applyAppearance(value) {
    appearance = normalizeAppearance(value);
    apply(preference);
    appearanceListeners.forEach((listener) => listener());
    return appearance;
  }
  window.scoreSenseAppearance = Object.freeze({
    getSnapshot: () => appearance,
    subscribe: (listener) => { appearanceListeners.add(listener); return () => appearanceListeners.delete(listener); },
    set: (value) => {
      const next = normalizeAppearance(value);
      try { localStorage.setItem(appearanceKey, JSON.stringify(next)); } catch { /* Session still works. */ }
      return applyAppearance(next);
    },
  });
  media?.addEventListener?.("change", () => { if (preference === "system") apply(preference); });
  window.addEventListener("storage", (event) => {
    if (event.key === appearanceKey || event.key === null) applyAppearance(parseAppearance(event.key === null ? read(appearanceKey) : event.newValue));
    if (event.key === key || event.key === null) apply(event.key === null ? read(key) : event.newValue);
  });
  apply(preference);
})();
