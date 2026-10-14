import {gameCenterMatchupScores, gameCenterTeamParts, playerGameState} from './gameCenterPresentation.js';

export const WEEK_OVERVIEW_COPY = {
 title:'This Week', yourMatchup:'Your matchup', across:'Across the league', around:'Around the league',
 activity:'Recent activity', standings:'Standings', details:'Matchup details', game:'Open Game center',
 review:'Review My team', refresh:'Refresh', refreshError:'Could not refresh. Showing the last update.',
 loading:'Loading your league', noMatchup:'No matchup is scheduled for your team this week.',
 noActivity:'No roster moves recorded for this week.', noStories:'League stories appear when matchup data is available.',
 provisional:'Live scores are provisional until results are final.', forecast:'Projections can change before kickoff.',
 empty:'No league matchups are available for this week.', before:'Before kickoff',
 missing:'Score pending', recordMissing:'Record unavailable', noLeague:'Open a shared league to see this week’s matchups.',
 manageLineup:'Manage lineup', allScores:'All scores', openWeek:'Back to This Week',
 injury:(name,status)=>`${name} is ${status.toLowerCase()} and in your lineup.`,
 emptySlots:(count)=>`${count} starting slot${count===1?' is':'s are'} empty.`,
 missingForecast:'Projection unavailable', recorded:'fantasy points', projected:'projected points',
};
export const teamKey = team => String(team?.hub_team_id ?? team?.roster_id ?? '');
export const identityTeam = team => ({id:teamKey(team),name:team?.team_name,owner_name:team?.owner_name});
export function overviewRecord(team, standings=[]) {
 const row=standings.find(r=>team?.hub_team_id!=null&&String(r.hub_team_id)===String(team.hub_team_id))
   ||standings.find(r=>team?.roster_id!=null&&String(r.roster_id)===String(team.roster_id));
 if(!row||row.wins==null||row.losses==null)return '';
 return `${row.wins}–${row.losses}${Number(row.ties)>0?`–${row.ties}`:''}`;
}
export function overviewState(data={},matchup,placeholder=false) {
 const [a,b]=matchup?.teams||[];
 const scores=gameCenterMatchupScores(a,b,data,placeholder);
 if(scores.home.pregame&&scores.away.pregame)return 'pregame';
 if(data.week_complete||data.scoring_control?.final)return 'final';
 if(data.has_live_games||data.live)return 'live';
 return 'pending';
}
export function overviewKickoff(team) {
 const times=(team?.starters||[]).map(p=>p.kickoff_at).filter(t=>t&&Number.isFinite(Date.parse(t)));
 return times.sort((a,b)=>Date.parse(a)-Date.parse(b))[0]||null;
}
export function overviewRemaining(team,data) {
 const filled=(team?.starters||[]).filter(p=>p.player_id||p.sleeper_player_id);
 if(!filled.length||filled.some(p=>playerGameState(p,data)==='unknown'))return null;
 return filled.filter(p=>playerGameState(p,data)!=='final').length;
}
export function overviewAlert(team) {
 const starters=team?.starters;
 if(!Array.isArray(starters))return null;
 const out=starters.find(p=>['OUT','IR','SUSPENDED'].includes(String(p.injury_status||'').toUpperCase()));
 if(out)return WEEK_OVERVIEW_COPY.injury(out.name,out.injury_status);
 const empty=starters.filter(p=>!p.player_id&&!p.sleeper_player_id&&(!p.name||p.name==='Empty')).length;
 return empty?WEEK_OVERVIEW_COPY.emptySlots(empty):null;
}
export function overviewStories(data={},placeholder=false) {
 const pairs=(data.matchups||[]).filter(m=>m.teams?.length===2).map(m=>{
  const score=gameCenterMatchupScores(m.teams[0],m.teams[1],data,placeholder);
  if([score.home.value,score.away.value].includes('—'))return null;
  return {m,score,gap:Math.abs(Number(score.home.value)-Number(score.away.value))};
 }).filter(Boolean);
 const stories=[];
 const pregame=pairs.filter(p=>p.score.home.pregame&&p.score.away.pregame);
 const actual=pairs.filter(p=>!p.score.home.pregame&&!p.score.away.pregame);
 const candidates=pregame.length===pairs.length?pregame:actual;
 const closest=[...candidates].sort((a,b)=>a.gap-b.gap)[0];
 if(closest){
  const [a,b]=closest.m.teams.map(t=>gameCenterTeamParts(t).owner||t.team_name);
  stories.push({title:closest.score.home.pregame?'Closest on paper':'Closest matchup',text:`${a} vs ${b} · ${closest.gap.toFixed(1)} ${closest.score.home.pregame?'projected points apart':'points apart'}.`});
 }
 if(data.week_complete&&!placeholder&&actual.length){
  const teams=actual.flatMap(({m,score})=>m.teams.map((t,i)=>({t,points:Number(i?score.away.value:score.home.value)})));
  const top=teams.sort((a,b)=>b.points-a.points)[0];
  stories.push({title:'Week’s high score',text:`${gameCenterTeamParts(top.t).owner||top.t.team_name} · ${top.points.toFixed(1)} points.`});
 }
 return stories;
}
export function activityCopy(item) {
 const owner=item.to_owner||item.from_owner;
 if(!item.player_name||!owner)return null;
 const verbs={add:'Added',waiver:'Added',drop:'Dropped',trade:'Traded for'};
 if(!verbs[item.event_type])return null;
 return {title:`${verbs[item.event_type]} ${item.player_name}`,owner,at:item.event_at};
}
