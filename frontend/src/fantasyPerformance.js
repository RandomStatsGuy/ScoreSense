import { HUB_SLUG_TO_ID } from "./routes.js";
import { observeFantasyMainThread } from "./fantasyFrameProfile.js";

// Explicitly opt-in, session-local console diagnostics. No telemetry upload,
// account/league/player identifiers, raw URLs, queries, headers or payloads.
let output = null;
let clock = () => performance.now();
let visit = null;
let nextId = 0;
const round = value => Math.round(value * 10) / 10;
export function fantasyDestination(path) {
  const segments = String(path).split("?")[0].split("/");
  return segments[1] === "hub" && Object.hasOwn(HUB_SLUG_TO_ID, segments[2]) ? HUB_SLUG_TO_ID[segments[2]] : null;
}
export function hubRequestKind(url) {
  const path = String(url).split("?")[0];
  if (!path.startsWith("/api/hub/")) return null;
  if (/^\/api\/hub\/league\/[^/]+\/live-scoring$/.test(path)) return "live-scoring";
  if (/^\/api\/hub\/league\/[^/]+\/teams\/[^/]+\/season-scores$/.test(path)) return "season-scores";
  if (/^\/api\/hub\/league\/[^/]+\/teams\/[^/]+\/room/.test(path)) return "team-room";
  if (/^\/api\/hub\/(?:league\/[^/]+\/)?lineup/.test(path)) return "lineup";
  const first = path.slice(9).split("/")[0];
  return ["workspace", "home", "week", "roster", "cap-sheet", "draft-pool", "value-sheet", "value-overlay", "presets"].includes(first) ? first : "other";
}
function emit(event, fields = {}, owner = visit) {
  if (!output) return;
  try { output({event, visit:owner?.id ?? null, destination:owner?.destination ?? null, ...fields}); } catch { /* Diagnostics must not break requests. */ }
}
export function configureFantasyDiagnostics(log, now = () => performance.now()) {
  output = log; clock = now; visit = null; nextId = 0;
}
export function beginFantasyVisit(path, started = clock()) {
  if (!output) return null;
  const destination = fantasyDestination(path);
  visit = destination ? {id:++nextId, destination, started, phases:new Set()} : null;
  if (visit) emit("route-start");
  return visit;
}
export function currentFantasyVisit() { return visit; }
function pageState() {
  return {visibility:document.visibilityState, focused:document.hasFocus?.() ?? null};
}
export function measureFantasyReady(destination, phase, owner = visit, options = {}) {
  if (!output || !owner || owner !== visit || owner.destination !== destination || owner.phases.has(phase)) return () => {};
  const requestFrame = options.requestFrame || globalThis.requestAnimationFrame;
  const cancelFrame = options.cancelFrame || globalThis.cancelAnimationFrame;
  const effectAt = clock();
  emit("data-ready", {phase, durationMs:round(effectAt-owner.started), ...pageState()}, owner);
  let firstAt, second, cancelled = false;
  const first = requestFrame(() => {
    if (cancelled || owner !== visit) return;
    firstAt = clock();
    emit("frame-wait", {phase, frame:1, durationMs:round(firstAt-effectAt), ...pageState()}, owner);
    second = requestFrame(() => {
      if (cancelled || owner !== visit) return;
      const finished = clock();
      emit("frame-wait", {phase, frame:2, durationMs:round(finished-firstAt), ...pageState()}, owner);
      markFantasyReady(destination, phase, owner, {
        dataReadyMs:round(effectAt-owner.started), frameWaitMs:round(finished-effectAt),
      });
    });
  });
  return () => { cancelled = true; cancelFrame(first); if (second !== undefined) cancelFrame(second); };
}
export function markFantasyReady(destination, phase, owner = visit, detail = {}) {
  if (!owner || owner !== visit || owner.destination !== destination || owner.phases.has(phase)) return;
  owner.phases.add(phase);
  emit("ready", {phase, durationMs:round(clock()-owner.started), ...detail, ...pageState()}, owner);
}
export function startHubRequest(url, method = "GET") {
  const kind = output && hubRequestKind(url);
  if (!kind) return () => {};
  const owner = visit, started = clock();
  return (response, error) => {
    const server = response?.headers?.get("server-timing")?.match(/(?:^|,)\s*hub;dur=([\d.]+)/);
    emit("api-headers", {kind, method, durationMs:round(clock()-started), serverMs:server ? Number(server[1]) : null,
      status:response?.status ?? null, outcome:error ? (error.name === "AbortError" ? "aborted" : "network-error") : "response"}, owner);
  };
}
export function startFantasyAction(action) {
  if (!output || !["lineup-swap", "lineup-fill"].includes(action)) return () => {};
  const owner = visit, started = clock();
  let done = false;
  return outcome => {
    if (done) return;
    done = true;
    const record = () => emit("action", {action, outcome:owner === visit ? outcome : "superseded", durationMs:round(clock()-started)}, owner);
    if (outcome === "saved") requestAnimationFrame(() => requestAnimationFrame(record));
    else record();
  };
}
export function startFantasyDiagnostics() {
  let enabled = false;
  try {
    const flag = new URLSearchParams(location.search).get("fantasyPerf");
    if (flag === "0") sessionStorage.removeItem("fantasy-perf");
    if (flag === "1") sessionStorage.setItem("fantasy-perf", "1");
    enabled = sessionStorage.getItem("fantasy-perf") === "1";
  } catch { return () => {}; }
  if (!enabled) return () => {};
  configureFantasyDiagnostics(row => console.info("[FantasyPerf] " + JSON.stringify(row)));
  emit("session", {build:document.querySelector('meta[name="scoresense-build"]')?.content || "dev", viewport:innerWidth,
    navigation:performance.getEntriesByType("navigation")[0]?.type || "unknown"});
  beginFantasyVisit(location.pathname, 0);
  const stateChanged = () => emit("page-state", {startTimeMs:round(clock()), ...pageState()});
  stateChanged();
  document.addEventListener("visibilitychange", stateChanged);
  window.addEventListener("focus", stateChanged);
  window.addEventListener("blur", stateChanged);
  const stopMainThread = observeFantasyMainThread((event, fields) => {
    const owner = fields.startTimeMs == null || (visit && fields.startTimeMs >= visit.started) ? visit : null;
    emit(event, fields, owner);
  });
  const clicked = e => {
    const anchor = e.target.closest?.("a[href]");
    if (!anchor || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || anchor.target || anchor.download) return;
    const target = new URL(anchor.href);
    if (target.origin === location.origin && target.pathname !== location.pathname) beginFantasyVisit(target.pathname);
  };
  document.addEventListener("click", clicked, true);
  const failed = () => emit("asset-error");
  window.addEventListener("vite:preloadError", failed);
  let observer;
  if (typeof PerformanceObserver !== "undefined") {
    observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const url = new URL(entry.name);
        if (url.origin !== location.origin) continue;
        const kind = hubRequestKind(url.pathname);
        const asset = /\/assets\/.*\.(js|css)$/.exec(url.pathname);
        if (!kind && !asset) continue;
        // Attribute by timestamp, never attach a late prior-route request to
        // the next visit. Earlier initial assets remain session-scoped.
        const owner = visit && entry.startTime >= visit.started ? visit : null;
        emit("resource", {kind:kind || asset[1], durationMs:round(entry.duration),
          status:entry.responseStatus || null,
          transferMs:round(entry.responseEnd-entry.responseStart), transferBytes:entry.transferSize,
          serverMs:entry.serverTiming?.find(t=>t.name === "hub")?.duration ?? null}, owner);
      }
    });
    observer.observe({type:"resource", buffered:true});
  }
  return () => {
    stopMainThread(); observer?.disconnect();
    document.removeEventListener("click", clicked, true);
    document.removeEventListener("visibilitychange", stateChanged);
    window.removeEventListener("focus", stateChanged);
    window.removeEventListener("blur", stateChanged);
    window.removeEventListener("vite:preloadError", failed);
    configureFantasyDiagnostics(null);
  };
}
