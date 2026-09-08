import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "DraftRoom.jsx"), "utf8");

test("DraftRoom declares myTeamId before the offline team seed effect", () => {
  const decl = src.indexOf("const myTeamId = roomState?.viewer?.team_id");
  const seed = src.indexOf("if (myTeamId && !offlineTeamId) setOfflineTeamId(myTeamId)");
  assert.ok(decl >= 0, "expected myTeamId declaration");
  assert.ok(seed >= 0, "expected offline team seed");
  assert.ok(
    decl < seed,
    "myTeamId is in the temporal dead zone of the offline seed effect and crashes every DraftRoom mount",
  );
});

test("DraftRoom only applies setup over live on an explicit reset", () => {
  assert.ok(src.includes("allowSetupDowngrade: true"));
  assert.ok(src.includes("wsReconnectDelayMs"));
  assert.ok(/if\s*\(\s*!roomStateRef\.current\s*\)\s*setRoomLoading\(\s*true\s*\)/.test(src));
  assert.ok(src.includes("onLiveDraftChangeRef"));
});
