import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAttentionItems,
  buildOpportunityItems,
  estimateOpportunityPoints,
  filterInjuriesByQuery,
  parseInjuryNoteDrivers,
  pickReplacementCandidates,
  playerKey,
  practiceLabel,
  slugifyName,
} from "./injuryExperience.js";

test("parseInjuryNoteDrivers extracts name + status", () => {
  const drivers = parseInjuryNoteDrivers(
    "Justin Jefferson (Questionable); Jordan Addison (Doubtful)",
  );
  assert.equal(drivers.length, 2);
  assert.equal(drivers[0].name, "Justin Jefferson");
  assert.equal(drivers[0].status, "Questionable");
  assert.equal(drivers[1].slug, "jordan-addison");
});

test("estimateOpportunityPoints converts boost fraction to points", () => {
  // final 16.8 with ~14.5% boost ≈ +2.1 from base
  assert.equal(estimateOpportunityPoints(16.8, 0.145), 2.1);
  assert.equal(estimateOpportunityPoints(10, 0), null);
});

test("buildAttentionItems keeps injured players on the projection slate", () => {
  const injuries = [
    {
      sleeper_id: "1",
      full_name: "Justin Jefferson",
      team: "MIN",
      position: "WR",
      injury_status: "Questionable",
      practice_participation: "Limited",
      news_updated: 1700000000000,
      injury_body_part: "Ankle",
    },
    {
      sleeper_id: "2",
      full_name: "Random Bench",
      team: "MIN",
      position: "WR",
      injury_status: "Out",
    },
  ];
  const projections = [
    {
      Player: "Justin Jefferson",
      Team: "MIN",
      Position: "WR",
      player_id: "jj",
      "Injury Status": "Questionable",
      "Projected Points": 18,
    },
  ];
  const items = buildAttentionItems({ injuries, projections, contextById: null });
  assert.equal(items.length, 1);
  assert.equal(items[0].injury.full_name, "Justin Jefferson");
  assert.equal(items[0].practice, "Limited");
  assert.equal(items[0].assumesActive, true);
});

test("buildOpportunityItems prefers fantasy skill drivers from Injury Note", () => {
  const injuries = [
    {
      sleeper_id: "1",
      full_name: "Justin Jefferson",
      team: "MIN",
      position: "WR",
      injury_status: "Questionable",
      gsis_id: "00-0036322",
    },
    {
      sleeper_id: "db",
      full_name: "Brian Branch",
      team: "DET",
      position: "DB",
      injury_status: "Questionable",
    },
  ];
  const projections = [
    {
      Player: "Jordan Addison",
      Team: "MIN",
      Position: "WR",
      player_id: "ja",
      "Injury Status": "",
      "Opportunity Adjustment": 0.14,
      "Injury Note": "Justin Jefferson (Questionable)",
      "Projected Points": 16.8,
    },
    {
      Player: "Amon-Ra St. Brown",
      Team: "DET",
      Position: "WR",
      player_id: "arsb",
      "Injury Status": "",
      "Injury Boost": 0.25,
      "Injury Note": "Brian Branch (Questionable)",
      "Projected Points": 20,
    },
  ];
  const items = buildOpportunityItems({
    projections,
    injuries,
    contextById: null,
    minPoints: 0.5,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Jordan Addison");
  assert.match(items[0].driverLabel, /Justin Jefferson/);
  assert.ok(items[0].points >= 1.5);
});

test("buildOpportunityItems falls back to Injury Boost alias column", () => {
  const injuries = [
    {
      sleeper_id: "1",
      full_name: "Justin Jefferson",
      team: "MIN",
      position: "WR",
      injury_status: "Questionable",
      gsis_id: "00-0036322",
    },
  ];
  const projections = [
    {
      Player: "Jordan Addison",
      Team: "MIN",
      Position: "WR",
      player_id: "ja",
      "Injury Status": "",
      "Injury Boost": 0.14,
      "Injury Note": "Justin Jefferson (Questionable)",
      "Projected Points": 16.8,
    },
  ];
  const items = buildOpportunityItems({
    projections,
    injuries,
    contextById: null,
    minPoints: 0.5,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Jordan Addison");
});

test("buildOpportunityItems uses player-context deltas when present", () => {
  const injuries = [
    {
      sleeper_id: "1",
      full_name: "Ja'Marr Chase",
      team: "CIN",
      position: "WR",
      injury_status: "Questionable",
      gsis_id: "00-0036322",
    },
  ];
  const projections = [
    {
      Player: "Tee Higgins",
      Team: "CIN",
      Position: "WR",
      player_id: "wr-higgins",
      "Injury Status": "",
      "Injury Boost": 0,
      "Injury Note": "",
      "Projected Points": 16.8,
    },
  ];
  const contextById = new Map([
    [
      "wr-higgins",
      {
        availability: { status: null },
        opportunity_adjustment: {
          included: true,
          points: 2.1,
          drivers: ["00-0036322"],
        },
        projection: { injury_delta: 2.1 },
      },
    ],
  ]);
  const items = buildOpportunityItems({ projections, injuries, contextById });
  assert.equal(items.length, 1);
  assert.equal(items[0].points, 2.1);
  assert.equal(items[0].pointsLabel, "+2.1");
  assert.match(items[0].driverLabel, /Ja'Marr Chase/);
});

test("pickReplacementCandidates returns healthy same-team mates", () => {
  const injured = {
    Player: "Justin Jefferson",
    Team: "MIN",
    Position: "WR",
    player_id: "jj",
    "Injury Status": "Questionable",
  };
  const projections = [
    injured,
    {
      Player: "Jordan Addison",
      Team: "MIN",
      Position: "WR",
      player_id: "ja",
      "Injury Status": "",
      "Projected Points": 14,
    },
    {
      Player: "Other Team WR",
      Team: "DET",
      Position: "WR",
      player_id: "x",
      "Injury Status": "",
      "Projected Points": 20,
    },
  ];
  const picks = pickReplacementCandidates(injured, projections, { limit: 2 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].Player, "Jordan Addison");
});

test("filterInjuriesByQuery matches name/team/status", () => {
  const list = [
    { full_name: "Justin Jefferson", team: "MIN", injury_status: "Questionable" },
    { full_name: "Chris Olave", team: "NO", injury_status: "Out" },
  ];
  assert.equal(filterInjuriesByQuery(list, "jeff").length, 1);
  assert.equal(filterInjuriesByQuery(list, "out").length, 1);
  assert.equal(filterInjuriesByQuery(list, "").length, 2);
});

test("practiceLabel and playerKey helpers", () => {
  assert.equal(practiceLabel({ practice_participation: "DNP" }), "DNP");
  assert.equal(practiceLabel({}), null);
  assert.equal(playerKey("A", "min"), "a|MIN");
  assert.equal(slugifyName("Ja'Marr Chase"), "jamarr-chase");
});
