/**
 * Run with: node --test frontend/src/dfsExport.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLineupDetailCsv,
  buildSiteLineupCsv,
  siteExportDisabledReason,
} from "./dfsExport.js";

function classicLineup({ withIds = true } = {}) {
  const id = (n) => (withIds ? String(n) : "");
  return {
    lineup: [
      { slot: "QB", player: "QB One", team: "KC", position: "QB", dfs_id: id(1), salary: 8000, value: 3.1, proj: 24.5, floor: 18, ceiling: 31 },
      { slot: "RB1", player: "RB One", team: "SF", position: "RB", dfs_id: id(2), salary: 9000, value: 2.4, proj: 21.9, floor: 15, ceiling: 28 },
      { slot: "RB2", player: "RB Two", team: "DET", position: "RB", dfs_id: id(3), salary: 6000, value: 2.6, proj: 15.8, floor: 10, ceiling: 22 },
      { slot: "WR1", player: "WR One", team: "MIN", position: "WR", dfs_id: id(4), salary: 8600, value: 2.3, proj: 19.7, floor: 12, ceiling: 27 },
      { slot: "WR2", player: "WR Two", team: "CIN", position: "WR", dfs_id: id(5), salary: 7200, value: 2.3, proj: 16.4, floor: 11, ceiling: 24 },
      { slot: "WR3", player: "WR Three", team: "KC", position: "WR", dfs_id: id(6), salary: 5100, value: 2.5, proj: 12.9, floor: 8, ceiling: 19 },
      { slot: "TE", player: "TE One", team: "LV", position: "TE", dfs_id: id(7), salary: 4400, value: 2.4, proj: 10.5, floor: 6, ceiling: 16 },
      { slot: "FLEX", player: "RB Three", team: "GB", position: "RB", dfs_id: id(8), salary: 5300, value: 2.4, proj: 12.6, floor: 8, ceiling: 18 },
      { slot: "DST", player: "Bears", team: "CHI", position: "DST", dfs_id: id(9), salary: 2800, value: 2.5, proj: 7.0, floor: 4, ceiling: 11 },
    ],
  };
}

function showdownLineup() {
  return {
    lineup: [
      { slot: "CPT", player: "QB Home", team: "SEA", position: "QB", dfs_id: "c1", salary: 15000, proj: 33.0, floor: 22, ceiling: 42 },
      { slot: "FLEX1", player: "WR Home", team: "SEA", position: "WR", dfs_id: "f5", salary: 10600, proj: 15.0, floor: 9, ceiling: 21 },
      { slot: "FLEX2", player: "RB Home", team: "SEA", position: "RB", dfs_id: "f3", salary: 8400, proj: 16.0, floor: 10, ceiling: 22 },
      { slot: "FLEX3", player: "RB Away", team: "NE", position: "RB", dfs_id: "f4", salary: 8200, proj: 14.0, floor: 9, ceiling: 20 },
      { slot: "FLEX4", player: "WR Away", team: "NE", position: "WR", dfs_id: "f6", salary: 7000, proj: 13.0, floor: 8, ceiling: 19 },
      { slot: "FLEX5", player: "TE Home", team: "SEA", position: "TE", dfs_id: "f7", salary: 5200, proj: 10.0, floor: 6, ceiling: 15 },
    ],
  };
}

test("draftkings export uses Name (ID) cells under position headers", () => {
  const result = buildSiteLineupCsv("draftkings", [classicLineup()]);
  assert.equal(result.ok, true);
  assert.equal(result.lines[0], '"QB","RB","RB","WR","WR","WR","TE","FLEX","DST"');
  assert.match(result.lines[1], /^"QB One \(1\)","RB One \(2\)"/);
  assert.match(result.lines[1], /"Bears \(9\)"$/);
  assert.equal(result.lines.length, 2);
});

test("fanduel export uses Id:Name cells and a DEF header", () => {
  const result = buildSiteLineupCsv("fanduel", [classicLineup()]);
  assert.equal(result.ok, true);
  assert.match(result.lines[0], /"DEF"$/);
  assert.match(result.lines[1], /^"1:QB One"/);
});

test("multi-lineup export writes one row per lineup", () => {
  const result = buildSiteLineupCsv("draftkings", [classicLineup(), classicLineup()]);
  assert.equal(result.ok, true);
  assert.equal(result.lines.length, 3);
});

test("showdown export leads with the CPT column", () => {
  const result = buildSiteLineupCsv("draftkings_showdown", [showdownLineup()]);
  assert.equal(result.ok, true);
  assert.equal(result.lines[0], '"CPT","FLEX","FLEX","FLEX","FLEX","FLEX"');
  assert.match(result.lines[1], /^"QB Home \(c1\)"/);

  const single = buildSiteLineupCsv("fanduel_single", [showdownLineup()]);
  assert.equal(single.ok, false); // MVP slot label differs from CPT
});

test("missing dfs ids fail with a helpful reason", () => {
  const result = buildSiteLineupCsv("draftkings", [classicLineup({ withIds: false })]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /player IDs are missing/i);

  const reason = siteExportDisabledReason("draftkings", [classicLineup({ withIds: false })]);
  assert.match(reason, /import the DraftKings salary CSV/i);
  assert.equal(siteExportDisabledReason("draftkings", [classicLineup()]), "");
  assert.match(siteExportDisabledReason("seasonal", [classicLineup()]), /detail CSV/i);
});

test("detail csv covers every slot and lineup", () => {
  const result = buildLineupDetailCsv([classicLineup(), classicLineup()], { isDfs: true });
  assert.equal(result.ok, true);
  assert.equal(result.lines.length, 1 + 18);
  assert.match(result.lines[0], /"Salary"/);
  assert.match(result.lines[1], /^"1","QB","QB One"/);

  const seasonal = buildLineupDetailCsv([classicLineup()], { isDfs: false });
  assert.equal(seasonal.ok, true);
  assert.doesNotMatch(seasonal.lines[0], /"Salary"/);
});
