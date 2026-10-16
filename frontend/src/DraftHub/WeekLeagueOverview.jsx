import React from 'react';
import {HubAlert,HubLoadingSkeleton,HubPage} from './HubUILayout';
import TeamIdentityMark from './TeamIdentityMark';
import MatchupBannerArt from './MatchupBannerArt';
import {identityFor} from './TeamIdentityContext';
import {formatRelativeTime} from '../format';
import {gameCenterMatchupScores,gameCenterTeamParts,formatStandingRecord,nativeScoreRefreshMessage} from './gameCenterPresentation';
import {WEEK_OVERVIEW_COPY as C,identityTeam,teamKey,overviewRecord,overviewScores,overviewState,overviewKickoff,overviewRemaining,overviewAlert,overviewStories,activityCopy} from './weekOverviewPresentation';
import '../styles/week-league-overview.css';

export const matchupHref=(team,week)=>`/hub/game?${new URLSearchParams({matchupTeam:teamKey(team),matchupWeek:String(week)})}`;
function Team({team,identity,score,record,remaining,featured=false,isYou=false}) {
 const parts=gameCenterTeamParts(team);
 return <div className={`week-overview-team${featured?' is-featured':''}${isYou?' is-you':''}`}>
  <TeamIdentityMark team={identityTeam(team)} identity={identity} size={featured?'lg':'sm'} />
  <div className="week-overview-owner"><strong>{isYou?'You':parts.owner||parts.team}</strong>{featured&&parts.team&&<span>{parts.team}</span>}{record&&<small>{record}</small>}</div>
  <div className="week-overview-score"><strong>{score.value}</strong>{featured&&<small>{score.pregame?C.projected:score.label}</small>}{featured&&!score.pregame&&remaining!=null&&<small>{remaining} players remaining</small>}</div>
 </div>;
}
export default function WeekLeagueOverview({data,hubContext,identities={},matchup,viewer,opponent,standingsView,banner,loading,error,onRefresh,onWeek,onNavigate,placeholder}) {
 const week=data?.week, maxWeek=data?.max_week||18;
 const standings=standingsView?.standings||[];
 const games=data?.matchups||[];
 const scores=gameCenterMatchupScores(viewer,opponent,data||{},placeholder);
 const state=overviewState(data||{},matchup,placeholder);
 const mine=identityFor(identities,identityTeam(viewer)), theirs=identityFor(identities,identityTeam(opponent));
 const alert=overviewAlert(viewer);
 const kickoff=overviewKickoff(viewer);
 const teamHref=`/hub/roster?${new URLSearchParams({lineup:'1',...(week?{week:String(week)}:{})})}`;
 const empty=!loading&&!error&&!games.length;
 const statusMessage=data?nativeScoreRefreshMessage(data):null;
 return <HubPage frameless className="week-overview">
  <header className="week-overview-heading"><div><h1>{C.title}</h1>{data?.season&&<p>{data.season} season</p>}</div>
   <div className="week-overview-stepper" role="group" aria-label="Week"><button className="btn-ghost" disabled={loading||!week||week<=1} onClick={()=>onWeek(-1)} aria-label="Previous week">‹</button><strong>{week?`Week ${week}`:'This week'}</strong><button className="btn-ghost" disabled={loading||!week||week>=maxWeek} onClick={()=>onWeek(1)} aria-label="Next week">›</button></div>
  </header>
  {error&&<HubAlert variant="warn">{data?C.refreshError:error}<button className="btn-ghost" onClick={onRefresh}>Try again</button></HubAlert>}
  {loading&&!data?<HubLoadingSkeleton label={C.loading} rows={5}/>:null}
  {empty?<HubAlert variant="neutral">{banner?.text||data?.hint||C.empty}{banner?.action&&<button className="btn-ghost" onClick={()=>onNavigate?.(banner.action)}>{banner.actionLabel}</button>}</HubAlert>:null}
  {data&&games.length>0&&<div className="week-overview-grid"><div className="week-overview-main">
   {viewer&&opponent?<section className="week-overview-feature" aria-label={C.yourMatchup}>
    <MatchupBannerArt identity={mine} side="home"/><MatchupBannerArt identity={theirs} side="away"/>
    <div className="week-overview-section-head"><h2>{C.yourMatchup}</h2><span>{state==='pregame'?C.before:state==='live'?'Live':state==='final'?'Final':C.missing}</span></div>
    <div className="week-overview-pair"><Team team={viewer} identity={mine} score={scores.home} record={overviewRecord(viewer,standings)} remaining={overviewRemaining(viewer,data)} featured isYou={teamKey(viewer)===String(hubContext?.team_id)||viewer.is_viewer}/><Team team={opponent} identity={theirs} score={scores.away} record={overviewRecord(opponent,standings)} remaining={overviewRemaining(opponent,data)} featured/></div>
    <footer><span>{state==='pregame'&&kickoff?`First kickoff · ${new Date(kickoff).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'})}`:state==='pregame'?'Kickoff time unavailable':state==='live'?C.provisional:state==='final'?'Matchup complete':C.missing}</span><a href={matchupHref(viewer,week)}>{state==='pregame'?C.details:C.game} →</a></footer>
   </section>:<section className="week-overview-panel"><p>{C.noMatchup}</p></section>}
   {alert&&<div className="week-overview-alert"><span>{alert}</span><a href={teamHref}>{C.review} →</a></div>}
   <WeekLeagueGames {...{data,hubContext,identities,placeholder}} />
  </div><aside className="week-overview-aside" aria-label={C.around}>
   <WeekLeagueUpdates data={data} placeholder={placeholder} />
   <details className="week-overview-panel week-overview-standings"><summary><span>{C.standings}<small>{standingsView?.note}</small></span><span aria-hidden="true" className="week-overview-toggle"/></summary>
    <ul>{standings.map(row=><li key={row.hub_team_id||row.roster_id}><span>{gameCenterTeamParts(row).owner||row.team_name}</span><strong>{row.wins!=null&&row.losses!=null?formatStandingRecord(row):'—'}</strong></li>)}</ul>
   </details>
  </aside></div>}
  {data&&<footer className="week-overview-freshness"><span>{data.synced_at?`League · ${formatRelativeTime(data.synced_at)}`:'League update time unavailable'}</span><button className="btn-link" onClick={onRefresh}>{C.refresh}</button></footer>}
 </HubPage>;
}

/** Shared league sections: consume the parent's saved scoring snapshot; never fetch. */
export function WeekLeagueGames({data,hubContext,identities={},placeholder=false}) {
 const games=data?.matchups||[],week=data?.week,standings=data?.standings||[];
 const state=overviewState(data||{},games[0],placeholder);
 const statusMessage=data?nativeScoreRefreshMessage(data):null;
 return <section className="week-overview-panel" aria-label="League scoreboard"><div className="week-overview-section-head"><h2>{C.across}</h2><span>{C.allScores}</span></div>
    <ul className="week-overview-games">{games.map(game=>{
     const [a,b]=game.teams||[], pair=overviewScores(a,b,data,placeholder);
     return <li key={game.matchup_id}><a href={matchupHref(a,week)} aria-label={`${gameCenterTeamParts(a).owner||a?.team_name} vs ${gameCenterTeamParts(b).owner||b?.team_name||'Bye'}, matchup details`}>
      <Team team={a} identity={identityFor(identities,identityTeam(a))} score={pair.home} record={overviewRecord(a,standings)} isYou={teamKey(a)===String(hubContext?.team_id)||a?.is_viewer}/>
      {b?<Team team={b} identity={identityFor(identities,identityTeam(b))} score={pair.away} record={overviewRecord(b,standings)} isYou={teamKey(b)===String(hubContext?.team_id)||b?.is_viewer}/>:<span>Bye</span>}<span className="week-overview-chevron" aria-hidden="true">›</span>
      <small className="week-overview-game-state">{pair.home.pregame&&pair.away.pregame?'Projected':overviewState(data,game,placeholder)==='final'?'Final':'Recorded points'}</small>
     </a></li>;
    })}</ul><p className="week-overview-note">{state==='pregame'?C.forecast:statusMessage||C.provisional}</p>
   </section>;
}

export function WeekLeagueUpdates({data,placeholder=false}) {
 const stories=overviewStories(data||{},placeholder);
 const activity=(data?.recent_activity||[]).map(activityCopy).filter(Boolean);
 return <><section className="week-overview-panel"><h2>{C.around}</h2>{stories.length?stories.map(story=><article key={story.title}><h3>{story.title}</h3><p>{story.text}</p></article>):<p className="week-overview-note">{C.noStories}</p>}</section>
   <section className="week-overview-panel"><h2>{C.activity}</h2>{activity.length?activity.map((item,index)=><article key={index}><small>{item.owner}{item.at?` · ${formatRelativeTime(item.at)}`:''}</small><h3>{item.title}</h3></article>):<p className="week-overview-note">{C.noActivity}</p>}</section></>;
}
