import test from "node:test";
import assert from "node:assert/strict";
import { rosterBoardRows, rosterDifference, rosterDifferenceLabel, rosterMoney } from "./leagueRostersPresentation.js";
const blocks = [{
  team: {
    id: 'a'
  },
  roster: [{
    player_id: '1',
    player_name: 'Alpha',
    position: 'QB',
    salary: 1,
    fair_value: 37
  }, {
    player_id: '2',
    player_name: 'Beta',
    position: 'RB',
    salary: 37,
    fair_value: 13
  }, {
    player_id: '3',
    player_name: 'Cut',
    salary: 1,
    fair_value: 30,
    roster_status: 'cut_before_draft'
  }]
}, {
  team: {
    id: 'b'
  },
  roster: [{
    player_id: '4',
    player_name: 'Equal',
    salary: 5,
    fair_value: 5
  }, {
    player_id: '5',
    player_name: 'Missing',
    salary: 8,
    fair_value: null
  }]
}];
test('roster board combines filters without including cuts or missing estimates as bargains', () => {
  assert.deepEqual(rosterBoardRows(blocks).map(r => r.player_id), ['1', '2']);
  assert.deepEqual(rosterBoardRows(blocks, {
    value: 'above'
  }).map(r => r.player_id), ['2']);
  assert.equal(rosterBoardRows(blocks, {
    teamId: 'b'
  }).length, 0);
  assert.equal(rosterBoardRows(blocks, {
    query: 'ALP',
    position: 'QB',
    value: 'below'
  }).length, 1);
  assert.deepEqual(rosterBoardRows(blocks, {
    view: 'teams',
    teamId: 'b'
  }).map(r => r.player_id), ['4', '5']);
});
test('missing currency and estimates remain unavailable; zero is valid', () => {
  for (const fair_value of [null, undefined, '', 'bad']) assert.equal(rosterDifference({
    salary: 1,
    fair_value
  }), null);
  assert.equal(rosterMoney(null), '—');
  assert.equal(rosterMoney(0), '$0');
  assert.equal(rosterDifferenceLabel({
    salary: 37,
    fair_value: 13
  }), '$24 above');
  assert.equal(rosterDifferenceLabel({
    salary: 1,
    fair_value: 37
  }), '$36 below');
  assert.equal(rosterDifferenceLabel({
    salary: 0,
    fair_value: 0
  }), 'At estimate');
});
test('salary sorting and name sorting are independent of difference sorting', () => {
  assert.deepEqual(rosterBoardRows(blocks, {
    sort: 'salary'
  }).map(r => r.player_id), ['2', '1']);
  assert.deepEqual(rosterBoardRows(blocks, {
    sort: 'name'
  }).map(r => r.player_id), ['1', '2']);
});
