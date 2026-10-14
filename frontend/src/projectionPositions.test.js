import test from 'node:test';
import assert from 'node:assert/strict';
import {filterProjectionPosition,projectionModelPosition,hasProjectionPosition} from './projectionPositions.js';
import {groupProjectionRows,projectionPosition} from './projectionTiers.js';
import {PROJECTION_POSITIONS,positionShort,starterCutoff} from './projectionsPresentation.js';

test('WR and TE are separate selectable positions backed by the same artifact family',()=>{
  assert.deepEqual(PROJECTION_POSITIONS.map(p=>p.id),['qb','rb','wr','te']);
  assert.deepEqual(PROJECTION_POSITIONS.map(p=>p.label),['QB','RB','WR','TE']);
  assert.equal(projectionModelPosition('wr'),'wr');
  assert.equal(projectionModelPosition('te'),'wr');
  assert.equal(projectionModelPosition('rb'),'rb');
  assert.equal(positionShort('wr'),'WR');assert.equal(positionShort('TE'),'TE');
  assert.equal(starterCutoff('te'),12);
});

test('Receiver filters keep their actual position, zero/depth players and ambiguous identities',()=>{
  const rows=[{player_id:'w',Position:'WR',points:19.9},{player_id:'t',position:'TE',points:15.3},
    {player_id:'zero',Position:'TE',points:0},{player_id:'negative',Position:'WR',points:-1},
    {player_id:'unknown',points:20},{player_id:'combined',Position:'WR/TE',points:25}];
  const before=structuredClone(rows);
  const wr=filterProjectionPosition(rows,'wr'),te=filterProjectionPosition(rows,'te');
  assert.deepEqual(wr.map(p=>p.player_id),['w','negative','unknown','combined']);
  assert.deepEqual(te.map(p=>p.player_id),['t','zero','unknown','combined']);
  assert.deepEqual(rows,before);
  for(const [position,filtered] of [['wr',wr],['te',te]]){
    const groups=groupProjectionRows(filtered,r=>r.points,undefined,r=>projectionPosition(r,position));
    assert.deepEqual(groups.find(g=>g.id==='unknown').rows.map(p=>p.player_id),['unknown','combined']);
    assert.equal(groups.find(g=>g.id==='S').rows.length,1);
    assert.equal(groups.find(g=>g.id==='F').rows.length,1);
  }
  assert.equal(filterProjectionPosition(rows,'rb'),rows);
});

test('Unknown receiver identity cannot claim a WR/TE rank or lead signal',()=>{
  assert.equal(hasProjectionPosition({Position:'WR'},'wr'),true);
  assert.equal(hasProjectionPosition({Position:'TE'},'te'),true);
  assert.equal(hasProjectionPosition({Position:'WR'},'te'),false);
  assert.equal(hasProjectionPosition({},'te'),false);
  assert.equal(hasProjectionPosition({Position:'WR/TE'},'wr'),false);
  assert.equal(hasProjectionPosition({},'qb'),true);
});
