import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVibeMatchup,
  formatSite,
  formatTeamLine,
  formatWeather,
} from "./vibeMatchup.js";

test("weather prefers a short field readout", () => {
  assert.equal(formatWeather({ temp: 78, wind: 9, roof: "outdoors" }), "78° · 9 mph");
  assert.equal(formatWeather({ roof: "dome", stadium: "Ford Field" }), "Dome");
  assert.equal(formatWeather({ roof: "outdoors" }), "Outdoors");
});

test("team line is signed spread plus total", () => {
  assert.equal(formatTeamLine({ spread: -3.5, total_line: 44.5 }), "-3.5 · O/U 44.5");
  assert.equal(formatTeamLine({ spread: 3.5, total_line: 44.5 }), "+3.5 · O/U 44.5");
});

test("site names home or away without calling it Draft Hub", () => {
  assert.equal(formatSite({ on_bye: true }), "Bye");
  assert.equal(formatSite({ team: "BUF" }, { opponent: "MIA", is_home: true }), "Home vs MIA");
  assert.equal(formatSite({ team: "BUF" }, { opponent: "HOU", is_home: false }), "Away @ HOU");
});

test("demo Josh Allen matchup stays on the front of the card", () => {
  const matchup = buildVibeMatchup({
    player_id: "demo-allen",
    player_name: "Josh Allen",
    team: "BUF",
    opponent: "MIA",
  }, {});
  assert.match(matchup.site, /Home vs MIA/);
  assert.match(matchup.line, /BUF/);
  assert.ok(matchup.facts.some((row) => row.id === "weather"));
});
