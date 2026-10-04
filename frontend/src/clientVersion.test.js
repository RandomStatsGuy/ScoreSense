import test from "node:test";
import assert from "node:assert/strict";
import { isProtectedReloadPath, startClientVersionWatcher, canReload } from "./clientVersion.js";
import { beginClientWrite } from "./clientActivity.js";

test("reloads wait until the visitor leaves drafts and editable screens", () => {
  for (const path of [
    "/hub/draft", "/tools/mock-draft", "/hub/rules", "/hub/trades",
    "/hub/roster", "/hub/cap", "/hub/free-agents", "/hub/roster-management/contracts",
    "/hub/office/contracts", "/tools/dfs", "/account", "/admin",
  ]) assert.equal(isProtectedReloadPath(path), true, path);
  for (const path of ["/", "/hub/home", "/hub/game", "/projections/weekly"])
    assert.equal(isProtectedReloadPath(path), false, path);
});

test("asset recovery is bounded, immediate and respects dialogs, writes and protected routes", async () => {
  const originals = Object.fromEntries(["window", "document", "navigator", "fetch", "sessionStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
  const events = new Map(), values = new Map();
  let reloads = 0, blocked = false, offline = false, deferProbe = false, finishProbe;
  const windowMock = {location:{href:"https://app.fourthdownlabs.com/hub/week",pathname:"/hub/week",replace:url=>{assert.match(url,/^\/api\/client-recovery\?/); reloads++;}},
    addEventListener:(name,handler)=>events.set(name,handler), removeEventListener:name=>events.delete(name),
    setInterval:()=>1, clearInterval:()=>{}};
  const documentMock = {visibilityState:"visible",activeElement:{matches:()=>false},
    querySelector:selector=>selector.startsWith("meta") ? {content:"same-build"} : (blocked ? {} : null),
    addEventListener:()=>{},removeEventListener:()=>{}};
  const mocks = {window:windowMock,document:documentMock,navigator:{},fetch:async url=>{
    if (offline) throw new Error("offline");
    if (deferProbe && url.startsWith("/api/client-recovery")) return new Promise(resolve => { finishProbe = resolve; });
    return Response.json({version:"same-build"});
  }, sessionStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
  for (const [key,value] of Object.entries(mocks)) Object.defineProperty(globalThis,key,{configurable:true,value});
  const settle = () => new Promise(resolve => setImmediate(resolve));
  let stop;
  try {
    stop = startClientVersionWatcher();
    await settle();
    assert.equal(reloads,0);
    blocked = true;
    events.get("vite:preloadError")();
    await settle();
    assert.equal(reloads,0);
    blocked = false;
    const finishWrite = beginClientWrite();
    assert.equal(canReload(),false);
    events.get("focus")();
    await settle();
    assert.equal(reloads,0);
    finishWrite(); finishWrite();
    windowMock.location.pathname = "/hub/rules";
    events.get("focus")();
    await settle();
    assert.equal(reloads,0);
    windowMock.location.pathname = "/hub/week";
    offline = true;
    events.get("focus")();
    await settle();
    assert.equal(reloads,0);
    offline = false;
    deferProbe = true;
    events.get("focus")();
    await settle();
    assert.equal(typeof finishProbe, "function");
    windowMock.location.pathname = "/hub/draft";
    windowMock.location.href = "https://app.fourthdownlabs.com/hub/draft";
    finishProbe(new Response("current shell"));
    await settle();
    assert.equal(reloads, 0);
    assert.equal(values.size, 0, "Cancelled recovery must not consume the same-build retry");
    deferProbe = false;
    windowMock.location.pathname = "/hub/week";
    windowMock.location.href = "https://app.fourthdownlabs.com/hub/week";
    events.get("focus")();
    await settle();
    assert.equal(reloads,1);
    events.get("vite:preloadError")();
    await settle();
    assert.equal(reloads,1);
  } finally {
    stop?.();
    for (const [key,descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];
    }
  }
});
