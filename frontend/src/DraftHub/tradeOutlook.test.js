import test from 'node:test';
import assert from 'node:assert/strict';
import { splitProjectedRoster, positionStrengthRanks, projectedTradeImpact, currentTradeCap } from './tradeOutlook.js';
const rules={roster:{qb:{starter:1},rb:{starter:1},wr:{starter:1},flex:{starter:1,positions:['RB','WR','TE']},k:{starter:1}}};
const row=(id,pos,salary=10,years=2)=>({player_id:id,position:pos,salary,contract:{years_remaining:years}});
const forecast=Object.fromEntries([['q',100],['r',80],['r2',70],['w',60],['in',90],['oq',95],['ow',85]].map(([id,p])=>[id,{remaining_points:p,annual_points:p*2}]));
const mine=[row('q','QB'),row('r','RB'),row('r2','RB'),row('w','WR'),row('k','K')];
test('max eligible starters do not reuse a player; missing kicker does not hide offensive ranks',()=>{
 const split=splitProjectedRoster(mine,rules,forecast);
 assert.equal(split.starterPoints,310);assert.equal(new Set(split.starters.map(r=>r.player_id)).size,5);
 const ranks=positionStrengthRanks({mine,other:[row('oq','QB'),row('ow','WR')]},rules,forecast);
 assert.equal(ranks.mine.QB.starters,1);assert.equal(ranks.mine.K.starters,null);assert.equal(ranks.mine.QB.bench,null);
});
test('trade distinguishes starter gain, bench gain, contract life and points per dollar',()=>{
 const parties=[{team_id:'mine',sends:[{player_id:'r2',to_team_id:'other'}],drops:[]},{team_id:'other',sends:[{player_id:'in',to_team_id:'mine'}],drops:[]}];
 const value=projectedTradeImpact({rosterByTeam:{mine,other:[row('in','WR',20,3)]},myTeamId:'mine',parties,rules,forecasts:forecast,salaryLeague:true});
 assert.equal(value.season,20);assert.equal(value.contract,240);assert.equal(value.starters,20);assert.equal(value.bench,0);assert.equal(value.efficiency,-2.5);
});
test('unknown FLEX competitor invalidates affected ranks and lineup deltas',()=>{
 const roster=[...mine,row('unknown','TE')];
 const ranks=positionStrengthRanks({mine:roster,other:mine},rules,forecast);
 assert.equal(ranks.mine.RB.starters,null);assert.equal(ranks.mine.QB.starters,1);
 const value=projectedTradeImpact({rosterByTeam:{mine:roster,other:[row('in','WR')]},myTeamId:'mine',parties:[{team_id:'mine',sends:[],drops:[]},{team_id:'other',sends:[{player_id:'in',to_team_id:'mine'}],drops:[]}],rules,forecasts:forecast,salaryLeague:false});
 assert.equal(value.starters,null);assert.equal(value.contract,null);
});
test('cut points count as a loss; current cap includes expiring salaries and dead cap',()=>{
 const impact=projectedTradeImpact({rosterByTeam:{mine},myTeamId:'mine',parties:[{team_id:'mine',sends:[],drops:['r2']}],rules,forecasts:forecast,salaryLeague:true});
 assert.equal(impact.season,-70);assert.equal(currentTradeCap([row('r','RB',16,0)],{dead_cap:6},200),178);
 assert.equal(currentTradeCap([{player_id:'x',salary:null}],{},200),null);
});

test('losing a starter can improve bench depth while weakening the lineup',()=>{
 const impact=projectedTradeImpact({rosterByTeam:{mine,other:[row('in','WR')]},myTeamId:'mine',parties:[{team_id:'mine',sends:[{player_id:'q',to_team_id:'other'}],drops:[]},{team_id:'other',sends:[{player_id:'in',to_team_id:'mine'}],drops:[]}],rules,forecasts:forecast,salaryLeague:true});
 assert.equal(impact.season,-10);assert.equal(impact.starters,-70);assert.equal(impact.bench,60);
});
