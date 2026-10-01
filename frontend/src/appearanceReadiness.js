// The ground scene belongs after the finished page, not after a short lazy
// fallback. Watch the shared content rather than duplicating every page's state.
const PLACEHOLDERS = [
  "[data-appearance-loading='true']",
  ".hub-loading-skeleton", ".table-skeleton", ".table-skeleton-row", ".mobile-data-list[aria-busy='true']",
  ".hub-insights-skeleton", ".hub-insights-overview--skeleton",
  ".rosters-skeleton", ".dfw-skeleton", ".fa-skeleton", ".ui-skeleton",
].join(",");
const LOADING_NOTES = "p.chart-note, p.hub-page-meta, .team-room-loading p";

function painted(element) {
  // A cached product pane can still contain skeletons while hidden. Decorative
  // skeletons themselves are aria-hidden, so that attribute alone isn't enough.
  const disclosure = element.closest("details:not([open])");
  if (disclosure && !disclosure.querySelector(":scope > summary")?.contains(element)) return false;
  return !element.closest("[hidden], .app-view-pane-hidden, [inert][aria-hidden='true']")
    && element.getClientRects().length > 0
    && element.ownerDocument.defaultView.getComputedStyle(element).visibility !== "hidden";
}

export function appearanceContentReady(root) {
  const content = root.querySelector("#main-content, .standalone-page");
  if (!content || !painted(content) || content.matches("[data-appearance-loading='true']")) return false;
  if ([...content.querySelectorAll(PLACEHOLDERS)].some(painted)) return false;
  return ![...content.querySelectorAll(LOADING_NOTES)].some((element) =>
    painted(element) && /^(loading|building|opening)\b/i.test(element.textContent.trim()));
}

export function observeAppearanceReadiness(root, onReady) {
  const view = root.ownerDocument.defaultView;
  let frame = 0;
  let stopped = false;
  let ready = false;
  const publish = (next) => {
    if (next !== ready) { ready = next; onReady(next); }
  };
  const check = () => {
    if (stopped) return;
    if (!appearanceContentReady(root)) {
      view.cancelAnimationFrame(frame);
      frame = 0;
      publish(false);
    } else if (!ready && !frame) {
      // Allow the committed content to lay out and paint. Recheck afterward in
      // case a page effect replaced an empty shell with its initial skeleton.
      frame = view.requestAnimationFrame(() => {
        frame = view.requestAnimationFrame(() => {
          frame = 0;
          if (!stopped) publish(appearanceContentReady(root));
        });
      });
    }
  };
  const observer = new view.MutationObserver(check);
  observer.observe(root, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["hidden", "class", "inert", "aria-hidden", "aria-busy", "data-appearance-loading", "open"],
  });
  check();
  return () => {
    stopped = true;
    observer.disconnect();
    view.cancelAnimationFrame(frame);
  };
}
