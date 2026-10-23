import test from "node:test";
import assert from "node:assert/strict";
import { gameCenterPlayerScore, gameCenterProjection, gameCenterTeamScore } from "./gameCenterPresentation.js";

for (const state of ["pregame", "live", "final", "unknown"]) {
  test(`confirmed bye replaces score and pregame copy during ${state}`, () => {
    for (const pregame_projection of [null, 16]) {
      const player = { name: "James Cook III", on_bye: true, proj: 0, points: null, game_state: state, pregame_projection };
      const before = { ...player };
      for (const placeholder of [true, false]) {
        assert.deepEqual(gameCenterPlayerScore(player, { live: true }, placeholder), {
          value: "Bye", label: "", secondary: "", state: "bye",
        });
      }
      assert.equal(gameCenterProjection(player), "Bye");
      assert.deepEqual(player, before);
    }
  });
}

test("confirmed bye source works without a separate flag", () => {
  assert.equal(gameCenterPlayerScore({ name: "Player", projection_source: "bye" }).value, "Bye");
});

test("zero points and missing projections do not imply a bye", () => {
  assert.equal(gameCenterPlayerScore({ name: "Player", points: 0, game_state: "live" }).value, "0.0");
  const unknown = gameCenterPlayerScore({ name: "Player", points: null, game_state: "unknown" }, { live: true });
  assert.equal(unknown.value, "—");
  assert.equal(unknown.secondary, "Pregame projection not saved");
  assert.equal(gameCenterPlayerScore({ name: "Player", proj: 0, game_state: "pregame" }).value, "0.0");
});

test("empty slots retain their own status even if a bye flag is present", () => {
  assert.equal(gameCenterPlayerScore({ name: "Empty", on_bye: true }).state, "empty");
});

test("bye display does not change projected team totals", () => {
  const starters = [{ name: "Playing", proj: 16, game_state: "pregame" },
    { name: "Bye player", proj: 0, game_state: "pregame", on_bye: true }];
  assert.equal(gameCenterTeamScore({ starters }).value, "16.0");
  assert.equal(gameCenterTeamScore({ starters }).pregame, true);
});
