import test from 'node:test';
import assert from 'node:assert/strict';
import {projectionTier,projectionValue,projectionPosition,PROJECTION_TIER_PROFILES,
  groupProjectionRows,projectionTierLayout,projectionTierWindow,remainingGameProjection} from './projectionTiers.js';

test('Each position and horizon partitions every boundary with open S/F tails',()=>{
  for(const [horizon,profiles] of Object.entries(PROJECTION_TIER_PROFILES))for(const [position,p] of Object.entries(profiles)){
    for(const [score,tier] of [[1e6,'S'],[p.S,'S'],[p.S-.001,'A'],[p.A,'A'],[p.A-.001,'B'],[p.B,'B'],[p.B-.001,'C'],[p.C,'C'],[p.C-.001,'D'],[p.F+.001,'D'],[p.F,'F'],[0,'F'],[-1e6,'F']])
      assert.equal(projectionTier(score,position,horizon),tier,`${horizon}/${position}/${score}`);
  }
});

test('Published industry leaders qualify without fitting the current model or filling tiers',()=>{
  for(const [position,total] of [['QB',367.1],['RB',370.4],['WR',338.3],['TE',260.4]]){
    assert.equal(projectionTier(total/17,position),'S');
    assert.equal(projectionTier(total,position,'season'),'S');
  }
  const rows=[{Position:'RB',points:18.2},{Position:'RB',points:17.8}];
  assert.equal(groupProjectionRows(rows,r=>r.points).some(g=>g.id==='S'),false);
  assert.equal(projectionTier(18.2,'RB'),'A');
  assert.equal(groupProjectionRows(rows.slice(0,1),r=>r.points)[0].id,'A'); // Filtering cannot promote the leader.
});

test('Season totals are classified on annual bands independently of weekly PPR',()=>{
  assert.equal(projectionTier(80,'RB','season'),'F');
  assert.equal(projectionTier(360,'RB','season'),'S');
  assert.equal(projectionTier(30,'RB'),'S');
  assert.equal(projectionTier(5,'RB'),'F');
  assert.equal(projectionTier(200,'WR','season'),'C');
  assert.equal(projectionTier(200,'TE','season'),'A');
});

test('Actual WR/TE identity takes priority and ambiguous/unsupported positions stay unknown',()=>{
  assert.equal(projectionPosition({Position:'TE'},'wr'),'TE');
  assert.equal(projectionPosition({position:'wr'},'wr'),'WR');
  assert.equal(projectionPosition({Position:'WR/TE',position:'te'},'wr'),'TE');
  assert.equal(projectionPosition({},'wr'),null);
  assert.equal(projectionPosition({},'te'),null);
  assert.equal(projectionPosition({Position:'K'},'rb'),null);
  assert.equal(projectionPosition({},'qb'),'QB');
  assert.equal(projectionPosition({},'rb'),'RB');
  assert.equal(projectionTier(15.3,'WR'),'A');
  assert.equal(projectionTier(15.3,'TE'),'S');
  assert.equal(projectionTier(25,null),'unknown');
  assert.equal(projectionTier(25,'K'),'unknown');
  assert.equal(projectionTier(25,'RB','unsupported'),'unknown');
});

test('Malformed and nonfinite points never become a zero-point player',()=>{
  for(const value of [null,undefined,'',' ',NaN,Infinity,-Infinity,true,false,{},[],'bad']){
    assert.equal(projectionValue(value),null);
    assert.equal(projectionTier(value,'RB'),'unknown');
  }
  assert.equal(projectionTier('0','RB'),'F');
});

test('Mixed grouping retains every occurrence, zero, unknown, status and unlimited F tail',()=>{
  const f=Array.from({length:800},(_,i)=>({id:i,Position:i%2?'WR':'TE',points:6-i/100}));
  const rows=[{id:'wr',Position:'WR',points:15.3},{id:'te',Position:'TE',points:15.3},...f,
    {id:'zero',Position:'WR',points:0},{id:'negative',Position:'TE',points:-4},
    {id:'missing',Position:'WR',points:null},{id:'ambiguous',points:25},
    {id:'out',Position:'WR',points:25,status:'inactive'},{id:'removed',Position:'WR',points:25,status:'left'}];
  rows.push(rows[5]);
  const groups=groupProjectionRows(rows,r=>r.points,r=>r.status),flattened=groups.flatMap(g=>g.rows);
  assert.equal(flattened.length,rows.length);
  assert.equal(groups.find(g=>g.id==='F').rows.length,803);
  assert.equal(flattened.filter(r=>r===rows[5]).length,2);
  assert.deepEqual(groups.find(g=>g.id==='unknown').rows.map(r=>r.id),['missing','ambiguous']);
  assert.equal(groups.find(g=>g.id==='S').rows[0].id,'te');
  assert.equal(groups.find(g=>g.id==='A').rows[0].id,'wr');
});

test('Remaining-game normalization rejects unknown and zero denominators',()=>{
  assert.equal(remainingGameProjection({'Games Remaining':10},180),18);
  assert.equal(remainingGameProjection({'Games Remaining':10},0),0);
  for(const games of [null,0,-1,'bad'])assert.equal(remainingGameProjection({'Games Remaining':games},180),null);
  assert.equal(remainingGameProjection({'Weeks Remaining':10},180),null);
  assert.equal(remainingGameProjection({'Games Remaining':10},null),null);
});

test('Windowing includes tier header offsets and reaches every player through the F tail',()=>{
  const rows=Array.from({length:500},(_,i)=>({id:i,Position:'RB',points:i===0?30:i<5?17:0}));
  const layout=projectionTierLayout(groupProjectionRows(rows,r=>r.points),88);
  assert.equal(layout.height,500*88+3*64);
  const seen=new Set();
  for(let pixel=0;pixel<layout.height;pixel+=375){
    const window=projectionTierWindow(layout,pixel,pixel+768);
    assert.equal(window.top+window.entries.reduce((sum,e)=>sum+e.height,0)+window.bottom,layout.height);
    window.entries.filter(e=>e.kind==='player').forEach(e=>seen.add(e.row.id));
  }
  assert.equal(seen.size,500);
  const end=projectionTierWindow(layout,layout.height-768,layout.height);
  assert.equal(end.entries.at(-1).row.id,499);
  assert.equal(end.bottom,0);
});
