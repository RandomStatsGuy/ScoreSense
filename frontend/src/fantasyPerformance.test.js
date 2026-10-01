import test from "node:test";
import assert from "node:assert/strict";
import {configureFantasyDiagnostics, beginFantasyVisit, markFantasyReady, measureFantasyReady, startFantasyDiagnostics, currentFantasyVisit, startHubRequest, startFantasyAction, hubRequestKind, fantasyDestination} from "./fantasyPerformance.js";

test("diagnostics are disabled by default and redact URLs and identifiers", () => {
  assert.equal(fantasyDestination("/hub/game?token=secret"), "week");
  assert.equal(hubRequestKind("/api/hub/league/private-id/teams/private-team/season-scores?email=secret"), "season-scores");
  assert.equal(hubRequestKind("/api/hub/secret-player-id"), "other");
  assert.equal(hubRequestKind("/api/hub/value-overlay?league_id=secret"), "value-overlay");
  assert.equal(hubRequestKind("/api/auth/login"), null);
  assert.equal(beginFantasyVisit("/hub/week"), null);
});

test("confirmed swaps wait for two frames and do not include background advice", () => {
  let now = 0;
  const rows = [], frames = [];
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  configureFantasyDiagnostics(row => rows.push(row), () => now);
  beginFantasyVisit("/hub/week");
  const finish = startFantasyAction("lineup-swap");
  now = 150;
  finish("saved"); finish("saved");
  assert.equal(rows.filter(row=>row.event === "action").length, 0);
  frames.shift()();
  now = 180;
  frames.shift()();
  const saved = rows.find(row=>row.event === "action");
  assert.equal(saved.outcome, "saved");
  assert.equal(saved.durationMs, 180);
  assert.equal(rows.filter(row=>row.event === "action").length, 1);
  configureFantasyDiagnostics(null);
  delete globalThis.requestAnimationFrame;
});

test("ready data and delayed frames stay separate without lowering the ready duration", () => {
  let now = 0;
  const rows = [], frames = [];
  globalThis.document = {visibilityState:"visible", hasFocus:()=>false};
  configureFantasyDiagnostics(row => rows.push(row), () => now);
  const owner = beginFantasyVisit("/hub/week");
  now = 200;
  const stop = measureFantasyReady("week", "lineup", owner, {requestFrame:cb=>frames.push(cb), cancelFrame:()=>{}});
  assert.equal(rows.find(row=>row.event === "data-ready").durationMs, 200);
  now = 1200; frames.shift()();
  now = 2200; frames.shift()();
  const ready = rows.find(row=>row.event === "ready");
  assert.equal(ready.durationMs, 2200);
  assert.equal(ready.dataReadyMs, 200);
  assert.equal(ready.frameWaitMs, 2000);
  assert.deepEqual(rows.filter(row=>row.event === "frame-wait").map(row=>row.durationMs), [1000,1000]);
  assert.equal(ready.focused, false);
  stop(); configureFantasyDiagnostics(null); delete globalThis.document;
});

test("cancelled or superseded readiness cannot complete a new visit, including frame handle zero", () => {
  const rows = [], frames = [], cancelled = [];
  globalThis.document = {visibilityState:"hidden"};
  configureFantasyDiagnostics(row=>rows.push(row), ()=>100);
  const owner = beginFantasyVisit("/hub/roster");
  let calls = 0;
  const options = {requestFrame:cb=>{frames.push(cb); return calls++ ? 0 : 9;}, cancelFrame:id=>cancelled.push(id)};
  const stop = measureFantasyReady("roster", "team-room", owner, options);
  frames.shift()(); stop(); frames.shift()();
  assert.deepEqual(cancelled, [9,0]);
  measureFantasyReady("roster", "roster-data", owner, options);
  beginFantasyVisit("/hub/week");
  frames.shift()();
  assert.equal(rows.filter(row=>row.event === "ready").length, 0);
  assert.equal(frames.length, 0);
  configureFantasyDiagnostics(null); delete globalThis.document;
});

test("disabled and mismatched readiness schedule no frame work", () => {
  const options = {requestFrame:()=>assert.fail("should not schedule a frame")};
  configureFantasyDiagnostics(null);
  measureFantasyReady("week", "lineup", null, options)();
  configureFantasyDiagnostics(()=>{});
  const owner = beginFantasyVisit("/hub/roster");
  measureFantasyReady("week", "lineup", owner, options)();
  configureFantasyDiagnostics(null);
});

test("startup is opt-in, captures state changes and cleans up every observer/listener", () => {
  const originals = Object.fromEntries(["location","sessionStorage","document","window","PerformanceObserver","innerWidth"].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const observers = [], logs = [], listeners = new Map();
  const add = (type, callback)=>listeners.set(type, callback);
  const remove = (type, callback)=>{assert.equal(listeners.get(type), callback); listeners.delete(type);};
  class Observer {
    static supportedEntryTypes = ["resource","longtask","long-animation-frame"];
    constructor(callback) {this.callback=callback; observers.push(this);}
    observe(options) {this.options=options;}
    disconnect() {this.disconnected=true;}
  }
  let stored = null, focused = true, visibility = "visible";
  const oldInfo = console.info;
  try {
    globalThis.location = {search:"?fantasyPerf=0",pathname:"/hub/week",origin:"https://example.test"};
    globalThis.sessionStorage = {getItem:()=>stored,setItem:(_key,value)=>{stored=value;},removeItem:()=>{stored=null;}};
    globalThis.document = {querySelector:()=>null,get visibilityState(){return visibility;},hasFocus:()=>focused,addEventListener:add,removeEventListener:remove};
    globalThis.window = {addEventListener:add,removeEventListener:remove};
    globalThis.PerformanceObserver = Observer;
    globalThis.innerWidth = 1280;
    console.info = text=>logs.push(JSON.parse(text.slice(14)));
    startFantasyDiagnostics()();
    assert.equal(observers.length,0); assert.equal(listeners.size,0);
    globalThis.location.search = "?fantasyPerf=1";
    const stop = startFantasyDiagnostics();
    assert.equal(observers.length,3);
    assert.equal(logs.find(row=>row.event === "page-state").focused,true);
    focused=false; visibility="hidden"; listeners.get("visibilitychange")();
    assert.equal(logs.at(-1).visibility,"hidden");
    const oldVisit = currentFantasyVisit();
    const newer = beginFantasyVisit("/hub/roster");
    observers.find(o=>o.options.type === "longtask").callback({getEntries:()=>[{startTime:oldVisit.started,duration:100}]});
    assert.equal(logs.at(-1).visit,null, "buffered old work must not belong to the new route");
    assert.ok(newer.started > oldVisit.started);
    stop();
    assert.equal(listeners.size,0);
    assert.ok(observers.every(o=>o.disconnected));
    assert.equal(currentFantasyVisit(),null);
  } finally {
    console.info = oldInfo;
    for (const [key,descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];
    }
    configureFantasyDiagnostics(null);
  }
});

test("ready phases deduplicate, reject late visits, and separate API from server time", () => {
  let now = 100;
  const rows = [];
  globalThis.document = {visibilityState:"visible"};
  configureFantasyDiagnostics(row => rows.push(row), () => now);
  const previous = beginFantasyVisit("/hub/week");
  const finish = startHubRequest("/api/hub/league/secret/lineup?token=private", "POST");
  now = 180;
  markFantasyReady("week", "lineup", previous);
  markFantasyReady("week", "lineup", previous);
  beginFantasyVisit("/hub/home");
  now = 250;
  markFantasyReady("week", "matchup", previous);
  finish(new Response(null, {headers:{'server-timing':'db;dur=2, hub;dur=50.1'}}));
  assert.equal(rows.filter(row => row.event === "ready").length, 1);
  assert.equal(rows.find(row => row.event === "ready").durationMs, 80);
  const api = rows.find(row => row.event === "api-headers");
  assert.equal(api.destination, "week");
  assert.equal(api.durationMs, 150);
  assert.equal(api.serverMs, 50.1);
  assert.equal(api.kind, "lineup");
  assert.doesNotMatch(JSON.stringify(rows), /secret|private|token/);
  configureFantasyDiagnostics(null);
  delete globalThis.document;
});
