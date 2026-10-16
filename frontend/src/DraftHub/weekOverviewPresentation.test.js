import test from 'node:test';
import assert from 'node:assert/strict';
import {overviewState,overviewRecord,overviewStories,overviewAlert,overviewRemaining,activityCopy} from './weekOverviewPresentation.js';
const team=(id,proj=10,points=0,state='pregame')=>({hub_team_id:id,roster_id:id,owner_name:id,points,starters:[{player_id:id,name:id,proj,points,game_state:state}]});
test('Pregame projections and recorded zero are distinct; missing totals remain missing',()=>{
 const match={teams:[team('A'),team('B',null)]};
 assert.equal(overviewState({placeholder:true},match,true),'pregame');
 assert.deepEqual(overviewStories({matchups:[match]},true),[]);
 assert.equal(overviewState({live:true},{teams:[team('A',10,0,'live'),team('B',12,0,'live')]}),'live');
 assert.equal(overviewState({scoring_control:{final:true}},{teams:[team('A',10,0,'final'),team('B',12,0,'final')]}),'final');
});
test('Stories use comparable known totals, and high score waits for confirmed completion',()=>{
 const a={teams:[team('A',10),team('B',12)]};
 const b={teams:[team('C',19),team('D',20)]};
 assert.match(overviewStories({matchups:[a,b]},true)[0].text,/C vs D · 1.0 projected/);
 const actual={teams:[team('A',10,0,'final'),team('B',12,7,'final')]};
 assert.equal(overviewStories({matchups:[actual]}).length,1);
 assert.match(overviewStories({week_complete:true,matchups:[actual]})[1].text,/B · 7.0/);
});
test('Unknown records and kickoff states stay unknown; injury alert targets the affected starter',()=>{
 assert.equal(overviewRecord(team('A'),[]),'');
 assert.equal(overviewRecord(team('A'),[{hub_team_id:'A',wins:0,losses:0}]),'0–0');
 assert.equal(overviewRemaining(team('A',10,0,'unknown'),{}),null);
 assert.equal(overviewAlert({starters:[{player_id:'A',name:'Hall',injury_status:'OUT'}]}),'Hall is out and in your lineup.');
 assert.equal(overviewAlert({}),null);
});
test('Activity renders only supported public move fields',()=>{
 assert.equal(activityCopy({event_type:'bid',player_name:'Secret',to_owner:'A'}),null);
 assert.equal(activityCopy({event_type:'add',player_name:'Player'}),null);
 assert.deepEqual(activityCopy({event_type:'add',player_name:'Player',to_owner:'A',event_at:'date'}),{title:'Added Player',owner:'A',at:'date'});
});

test("league games and stories honor the same approaching-week mode as the landing hero", async()=>{
 const {overviewScores}=await import('./weekOverviewPresentation.js');
 const a={owner_name:'A',points:90,proj_total:100,starters:[{player_id:'a',proj:100,game_state:'final'}]};
 const b={owner_name:'B',points:50,proj_total:102,starters:[{player_id:'b',proj:102,game_state:'final'}]};
 const data={home_display_mode:'projected',matchups:[{teams:[a,b]}]};
 assert.deepEqual([overviewScores(a,b,data).home.value,overviewScores(a,b,data).away.value],['100.0','102.0']);
 assert.equal(overviewStories(data)[0].title,'Closest on paper');
 assert.match(overviewStories(data)[0].text,/2.0 projected points apart/);
});
