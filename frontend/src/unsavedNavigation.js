/**
 * In-app navigation gate for unsaved editors (Rules, later others).
 * Register a blocker while the editor is mounted. navigateTo asks it first.
 */

let blocker = null;
let prompting = false;

export function setUnsavedNavigationBlocker(fn) {
  blocker = typeof fn === "function" ? fn : null;
}

export async function allowUnsavedNavigation(nextPath = "") {
  if (typeof blocker !== "function") return true;
  if (prompting) return false;
  prompting = true;
  try {
    return Boolean(await blocker(nextPath));
  } finally {
    prompting = false;
  }
}

export function isHubRulesPath(path) {
  return String(path || "").split("?")[0] === "/hub/rules";
}
