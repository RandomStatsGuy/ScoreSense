import test from "node:test";
import assert from "node:assert/strict";
import {configureFantasyDiagnostics, beginFantasyVisit, markFantasyReady, startHubRequest, startFantasyAction, hubRequestKind, fantasyDestination} from "./fantasyPerformance.js";

test("diagnostics are disabled by default and redact URLs and identifiers", () => {
  assert.equal(fantasyDestination("/hub/game?token=secret"), "week");
  assert.equal(hubRequestKind("/api/hub/league/private-id/teams/private-team/season-scores?email=secret"), "season-scores");
  assert.equal(hubRequestKind("/api/hub/secret-player-id"), "other");
  assert.equal(hubRequestKind("/api/auth/login"), null);
  assert.equal(beginFantasyVisit("/hub/week"), null);
});

test("confirmed swaps measure through paint and do not include background advice", () => {
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
