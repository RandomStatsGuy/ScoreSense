/** Route-level nav should be real links. Intercept unmodified left-clicks. */

export function isModifiedClick(event) {
  return Boolean(
    event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
    || event.button !== 0,
  );
}

export function interceptAppNav(event, navigate) {
  if (event.defaultPrevented || isModifiedClick(event)) return false;
  event.preventDefault();
  navigate();
  return true;
}
