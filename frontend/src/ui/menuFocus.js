// Safari does not focus clicked buttons (relatedTarget is null), and a press on menu padding moves
// focus to the nearest focusable ancestor such as <main tabindex="-1">. Neither means the user left.
export function focusLeftMenu(event) {
  const next = event.relatedTarget;
  const menu = event.currentTarget;
  return Boolean(next) && !menu.contains(next) && !next.contains(menu);
}
