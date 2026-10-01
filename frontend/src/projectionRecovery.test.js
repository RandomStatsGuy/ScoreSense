import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeForecastStatus } from './DraftHub/leagueTradesPresentation.js';
import { dfsPoolFreshness } from './dfsToolPresentation.js';

test('trade loading, recovery, error, and genuine coverage gaps are distinct', () => {
  assert.match(tradeForecastStatus(null), /Loading/);
  assert.match(tradeForecastStatus({recovery:{status:'running'}}), /Updating/);
  assert.match(tradeForecastStatus({error:true}), /failed/);
  assert.match(tradeForecastStatus({missing_player_ids:['x']}), /1 player still needs/);
  assert.equal(tradeForecastStatus({missing_player_ids:[]}), '');
});
test('successful DFS fetch does not hide requested-slate recovery or saved-data use', () => {
  const base={source:'live',checkedAt:Date.now(),refresh:{last_success_at:new Date().toISOString()}};
  assert.match(dfsPoolFreshness({...base,recovery:{status:'queued'}}).label, /Updating/);
  assert.equal(dfsPoolFreshness({...base,projectionStale:true}).tone, 'warning');
  assert.equal(dfsPoolFreshness({...base,source:'upload',recovery:{status:'queued'}}).tone, 'neutral');
});
