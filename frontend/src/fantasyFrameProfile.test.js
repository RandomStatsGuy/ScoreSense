import test from "node:test";
import assert from "node:assert/strict";
import {summarizeLongFrame, observeFantasyMainThread} from "./fantasyFrameProfile.js";

test("long frame attribution is bounded and strips URL, DOM and function details", () => {
  const scripts = Array.from({length:7}, (_,i)=>({duration:10+i,sourceURL:i === 6 ? "https://external.test/private.js?token=secret" : i === 5 ? "https://example.test/assets/WeeklyExperience-abc.js?token=secret" : "https://example.test/private-account.js",invokerType:"event-listener",invoker:"DIV#private-player.onclick",sourceFunctionName:"private-name",sourceCharPosition:42,forcedStyleAndLayoutDuration:1.24}));
  const row = summarizeLongFrame({startTime:10,duration:100,blockingDuration:50,renderStart:70,styleAndLayoutStart:80,scripts}, "https://example.test");
  assert.equal(row.blockingMs,50);
  assert.equal(row.renderToFrameEndMs,40);
  assert.equal(row.styleAndLayoutToFrameEndMs,30);
  assert.equal(row.scripts.length,5);
  assert.deepEqual(row.scripts.map(s=>s.asset),["external","WeeklyExperience-abc.js","app","app","app"]);
  assert.equal(row.scripts[0].sourceCharPosition,42);
  assert.equal(row.scripts[0].forcedStyleAndLayoutMs,1.2);
  assert.doesNotMatch(JSON.stringify(row),/private|secret|token|https|onclick/);
  assert.equal(scripts[0].duration,10,"do not mutate browser entries");
});

test("missing attribution is explicit and unknown invoker types cannot leak strings", () => {
  const row = summarizeLongFrame({startTime:0,duration:90,blockingDuration:0,renderStart:0,styleAndLayoutStart:0,scripts:[{sourceURL:"",invokerType:"private-player",sourceCharPosition:-1,duration:NaN}]}, "https://example.test");
  assert.equal(row.renderToFrameEndMs,0);
  assert.equal(row.scripts[0].asset,"inline");
  assert.equal(row.scripts[0].invokerType,"other");
  assert.equal(row.scripts[0].durationMs,null);
  assert.equal(row.scripts[0].sourceCharPosition,null);
});

test("unsupported APIs and observe failures keep diagnostics usable", () => {
  const rows = [];
  observeFantasyMainThread((event,fields)=>rows.push({event,...fields}),{Observer:null})();
  assert.deepEqual(rows,[{event:"profile-support",longFrames:false,longTasks:false}]);
  class Observer {static supportedEntryTypes=["long-animation-frame"]; observe(){throw new Error("unsupported");}}
  observeFantasyMainThread((event,fields)=>rows.push({event,...fields}),{Observer})();
  assert.equal(rows.at(-1).event,"profile-unavailable");
});

test("observers disconnect and cap combined long-task/frame output at 200", () => {
  const rows = [], observers = [];
  class Observer {
    static supportedEntryTypes=["long-animation-frame","longtask"];
    constructor(callback){this.callback=callback;observers.push(this);}
    observe(options){this.options=options;}
    disconnect(){this.disconnected=true;}
  }
  const stop = observeFantasyMainThread((event,fields)=>rows.push({event,...fields}),{Observer,origin:"https://example.test"});
  assert.ok(observers.every(o=>o.options.buffered));
  observers[0].callback({getEntries:()=>[{startTime:1,duration:60,blockingDuration:10,scripts:[]}]});
  observers[1].callback({getEntries:()=>Array.from({length:200},(_,i)=>({startTime:100+i,duration:60,attribution:[{containerId:"secret"}]}))});
  assert.equal(rows.filter(row=>["long-task","long-frame"].includes(row.event)).length,200);
  assert.equal(rows.at(-1).event,"profile-limit");
  assert.ok(observers.every(o=>o.disconnected));
  observers[0].callback({getEntries:()=>[{startTime:500,duration:60}]});
  assert.equal(rows.at(-1).event,"profile-limit");
  assert.doesNotMatch(JSON.stringify(rows),/secret/);
  stop();
});
