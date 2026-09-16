// Runs before the app/CSS loads so returning visitors never see the wrong theme.
(() => {
  const key = "scoresense-color-theme";
  const listeners = new Set();
  const normalize = (value) => value === "light" ? "light" : "dark";
  let current = "dark";
  try { current = normalize(localStorage.getItem(key)); } catch { /* Private storage is optional. */ }
  function apply(value) {
    current = normalize(value);
    document.documentElement.dataset.theme = current;
    document.documentElement.style.colorScheme = current;
    document.documentElement.style.backgroundColor = current === "light" ? "#edf1f1" : "#070d17";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", current === "light" ? "#edf1f1" : "#070d17");
    listeners.forEach((listener) => listener());
  }
  window.scoreSenseTheme = Object.freeze({
    getSnapshot: () => current,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (value) => {
      const next = normalize(value);
      try { localStorage.setItem(key, next); } catch { /* Keep the in-session choice working. */ }
      apply(next);
    },
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
  apply(current);
})();
