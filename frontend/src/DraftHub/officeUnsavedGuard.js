/**
 * In-app navigation gate for Roster management · Contracts pending writes.
 * BrowserRouter has no data-router useBlocker; navigateTo is the choke point.
 */

let dirty = false;
let confirmLeave = null;

export function setOfficeUnsavedGuard(isDirty, confirmFn) {
  dirty = Boolean(isDirty);
  confirmLeave = typeof confirmFn === "function" ? confirmFn : null;
}

export function hasOfficeUnsaved() {
  return dirty;
}

export async function allowOfficeNavigation() {
  if (!dirty || !confirmLeave) return true;
  return confirmLeave();
}

export function resetOfficeUnsavedGuard() {
  dirty = false;
  confirmLeave = null;
}
