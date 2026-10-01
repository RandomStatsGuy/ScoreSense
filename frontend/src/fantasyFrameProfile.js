// Only called by the opt-in Fantasy profiler. Never retain raw performance
// entries: script invokers/URLs can contain DOM ids, queries or private data.
const ms = value => Number.isFinite(value) ? Math.round(Math.max(0, value) * 10) / 10 : null;
const invokerTypes = new Set(["user-callback", "event-listener", "resolve-promise", "reject-promise", "classic-script", "module-script"]);

function assetKind(source, origin) {
  if (!source) return "inline";
  try {
    const url = new URL(source, origin);
    if (url.origin !== origin) return "external";
    const asset = /^\/assets\/([a-zA-Z0-9_.-]+\.js)$/.exec(url.pathname);
    return asset ? asset[1] : "app";
  } catch { return "unknown"; }
}

export function summarizeLongFrame(entry, origin) {
  const end = entry.startTime + entry.duration;
  const scripts = Array.from(entry.scripts || []).sort((a, b) => b.duration - a.duration).slice(0, 5);
  return {
    startTimeMs: ms(entry.startTime), durationMs: ms(entry.duration),
    blockingMs: ms(entry.blockingDuration),
    renderToFrameEndMs: entry.renderStart ? ms(end - entry.renderStart) : 0,
    styleAndLayoutToFrameEndMs: entry.styleAndLayoutStart ? ms(end - entry.styleAndLayoutStart) : 0,
    scripts: scripts.map(script => ({
      asset: assetKind(script.sourceURL, origin),
      invokerType: invokerTypes.has(script.invokerType) ? script.invokerType : "other",
      durationMs: ms(script.duration),
      forcedStyleAndLayoutMs: ms(script.forcedStyleAndLayoutDuration),
      sourceCharPosition: Number.isInteger(script.sourceCharPosition) && script.sourceCharPosition >= 0 ? script.sourceCharPosition : null,
    })),
  };
}

export function observeFantasyMainThread(record, {
  Observer = globalThis.PerformanceObserver,
  origin = globalThis.location?.origin,
} = {}) {
  const types = Observer?.supportedEntryTypes || [];
  const supported = {longFrames: types.includes("long-animation-frame"), longTasks: types.includes("longtask")};
  record("profile-support", supported);
  const observers = [];
  let count = 0, stopped = false;
  const stop = () => { stopped = true; observers.forEach(observer => observer.disconnect()); };
  const observe = (type, event, summarize) => {
    try {
      const observer = new Observer(list => {
        for (const entry of list.getEntries()) {
          if (stopped) return;
          if (count++ >= 200) { record("profile-limit", {limit: 200}); stop(); return; }
          record(event, summarize(entry));
        }
      });
      observer.observe({type, buffered: true});
      observers.push(observer);
    } catch { record("profile-unavailable", {kind: event}); }
  };
  if (supported.longFrames) observe("long-animation-frame", "long-frame", entry => summarizeLongFrame(entry, origin));
  if (supported.longTasks) observe("longtask", "long-task", entry => ({startTimeMs: ms(entry.startTime), durationMs: ms(entry.duration)}));
  return stop;
}
