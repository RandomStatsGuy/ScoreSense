import test from 'node:test';
import assert from 'node:assert/strict';
import {isByeWeek} from './weeklyAvailability.js';
import {weeklyQuantiles,weeklyPeerStats,weeklyBoardSignals,weeklyBoardPreview,isBoardAvailable} from './projectionsPresentation.js';
import {groupProjectionRows} from './projectionTiers.js';

test('Only explicit schedule evidence establishes bye weeks',()=>{
  for(const row of [{Opponent:'BYE'},{Opponent:' bye '},{opponent:'Bye week'},{is_bye:true}])assert.equal(isByeWeek(row),true);
  for(const row of [null,{}, {Opponent:''},{Opponent:null},{Opponent:'BUF'},{is_bye:false},{bye_week:6}])assert.equal(isByeWeek(row),false);
});

test('High conditional bye forecasts cannot lead a weekly tier or signal',()=>{
  const bye={player_id:'bye',Player:'On bye',Position:'WR',Opponent:'BYE','Projected Points':40,'Low (P10)':30,'High (P90)':50,rank_delta:20,p50_delta:20};
  const active={player_id:'active',Player:'Playing',Position:'WR',Opponent:'BUF','Projected Points':19.9,'Low (P10)':12,'High (P90)':27,rank_delta:1,p50_delta:1};
  assert.equal(isBoardAvailable(bye),false);
  assert.equal(isBoardAvailable(active),true);
  assert.equal(weeklyQuantiles(bye).p50,null);
  const peers=weeklyPeerStats([bye,active],{position:'wr'});
  assert.equal(peers.count,1);
  for(const signal of weeklyBoardSignals([bye,active],{position:'wr'}).slice(0,3))assert.equal(signal.playerId,'active');
  const preview=weeklyBoardPreview(bye,peers,{position:'wr'});
  assert.equal(preview.bye,true);
  assert.equal(preview.p50,null);
  const groups=groupProjectionRows([bye,active],r=>r['Projected Points'],r=>isByeWeek(r)?'bye':null);
  assert.equal(groups.find(g=>g.id==='S').rows[0],active);
  assert.equal(groups.find(g=>g.id==='bye').rows[0],bye);
  assert.equal(groups.flatMap(g=>g.rows).length,2);
});

test('Missing weekly forecasts stay unknown instead of becoming zero',()=>{
  assert.equal(weeklyQuantiles({'Projected Points':null}).p50,null);
  assert.equal(weeklyQuantiles({'Projected Points':0}).p50,0);
});
