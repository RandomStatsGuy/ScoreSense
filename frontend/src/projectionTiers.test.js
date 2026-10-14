import test from 'node:test';
import assert from 'node:assert/strict';
import {projectionTier, projectionValue, groupProjectionRows, projectionTierLayout, projectionTierWindow, remainingGameProjection} from './projectionTiers.js';

test('Every boundary belongs to exactly one tier, with unbounded S and F tails', () => {
  for (const [score,tier] of [[10000,'S'],[24,'S'],[23.999,'A'],[18,'A'],[17.999,'B'],[12,'B'],[11.999,'C'],[9,'C'],[8.999,'D'],[6.001,'D'],[6,'F'],[5.999,'F'],[0,'F'],[-100,'F']]) {
    assert.equal(projectionTier(score),tier, String(score));
  }
});

test('Missing, malformed, and nonfinite inputs never become a zero-point F player', () => {
  for (const value of [null,undefined,'',' ',NaN,Infinity,-Infinity,true,false,{},[], 'bad']) {
    assert.equal(projectionValue(value),null);
    assert.equal(projectionTier(value),'unknown');
  }
  assert.equal(projectionTier('0'),'F');
});

test('Grouping retains all rows and duplicates; a large F tier has no cap', () => {
  const f=Array.from({length:800},(_,i)=>({id:i,points:6-i/100}));
  const rows=[{id:'top',points:45},...f,{id:'zero',points:0},{id:'negative',points:-4},{id:'missing',points:null},{id:'out',points:25,status:'inactive'},{id:'removed',points:25,status:'left'}];
  rows.push(rows[5]);
  const groups=groupProjectionRows(rows,r=>r.points,r=>r.status);
  const flattened=groups.flatMap(g=>g.rows);
  assert.equal(flattened.length, rows.length);
  assert.equal(groups.find(g=>g.id==='F').rows.length,803);
  assert.equal(flattened.filter(r=>r===rows[5]).length,2);
  assert.equal(groups.find(g=>g.id==='unknown').rows[0].id,'missing');
  assert.deepEqual(groups.find(g=>g.id==='F').rows.slice(-3).map(r=>r.id),['zero','negative',4]);
});

test('Season normalization uses remaining games, never a season total or unknown denominator', () => {
  assert.equal(remainingGameProjection({'Games Remaining':10},180),18);
  assert.equal(remainingGameProjection({'Games Remaining':10},0),0);
  for(const games of [null,0,-1,'bad'])assert.equal(remainingGameProjection({'Games Remaining':games},180),null);
  assert.equal(remainingGameProjection({'Weeks Remaining':10},180),null);
  assert.equal(remainingGameProjection({'Games Remaining':10},null),null);
});

test('Pixel window includes tier header offsets and reaches every player through the final F row', () => {
  const rows=Array.from({length:500},(_,i)=>({id:i,points:i===0?30:i<5?20:0}));
  const layout=projectionTierLayout(groupProjectionRows(rows,r=>r.points),88);
  assert.equal(layout.height,500*88+3*64);
  const seen=new Set();
  for(let pixel=0;pixel<layout.height;pixel+=375) {
    const window=projectionTierWindow(layout,pixel,pixel+768);
    assert.equal(window.top+window.entries.reduce((sum,e)=>sum+e.height,0)+window.bottom,layout.height);
    window.entries.filter(e=>e.kind==='player').forEach(e=>seen.add(e.row.id));
  }
  assert.equal(seen.size,500);
  const end=projectionTierWindow(layout,layout.height-768,layout.height);
  assert.equal(end.entries.at(-1).row.id,499);
  assert.equal(end.bottom,0);
});
