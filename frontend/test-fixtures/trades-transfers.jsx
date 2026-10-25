import CommunicationPanel from "../src/DraftHub/CommunicationPanel";
// Production trade components with isolated, deterministic writes; never contacts a league.
import React, {useState} from "react";
import LeagueContextBanner from "../src/DraftHub/LeagueContextBanner";
import {LeagueChromeProvider} from "../src/DraftHub/leagueChromeContext";
import MobileHeader from "../src/layout/MobileHeader";
import ChatLauncher from "../src/DraftHub/ChatLauncher";
import {CommunicationProvider} from "../src/DraftHub/CommunicationContext";
import MobileShell from "../src/layout/MobileShell";
import MobileMenuSheet from "../src/layout/MobileMenuSheet";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import useMobileLayout from "../src/useMobileLayout";
import { createRoot } from "react-dom/client";
import LeagueTrades from "../src/DraftHub/LeagueTrades";
import HubSubnav from "../src/DraftHub/HubSubnav.jsx";
import {MemoryRouter} from "react-router-dom";
import {TeamIdentityProvider} from "../src/DraftHub/TeamIdentityContext";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/fantasy-chat.css";


const params=new URLSearchParams(location.search),state=params.get('state')||'salary';
const salary=state!=='pick';
const rules={salary_cap:200,draft_type:salary?'auction':'snake',contracts:{cut_refund_pct:.5},roster:{qb:{starter:1},rb:{starter:1},wr:{starter:1},te:{starter:1},flex:{starter:1,positions:['RB','WR','TE']},k:{starter:0},def:{starter:0}}};
const context={mode:'league',league_id:'trades-fixture',team_id:state==='readonly'?'':'mine',owner_name:'Maya Chen',team_name:'Sunday Roster',league_name:'Bottom to Top',draft_completed:true,is_commissioner:false,rules,capabilities:{uses_salaries:salary,uses_contracts:salary}};
if(state==='sleeper'||state==='review')context.sleeper_league_id='sleeper-fixture';
if(state==='predraft')context.draft_completed=false;
if(state==='capabilities-pick')context.capabilities={uses_salaries:false,uses_contracts:false};
const teamNames=['Sunday Roster','Sunday Rivals','Mountain Kings','Midnight Blitz','Fourth & Forever','Coastal Crew'];
const owners=['Maya Chen','Jordan Davis','Morgan Lee','Alex Rivera','Taylor Reed','Sam Carter'];
const people=[['Josh Allen','QB','BUF'],['James Cook','RB','BUF'],['Bijan Robinson','RB','ATL'],['DeVonta Smith','WR','PHI'],['CeeDee Lamb','WR','DAL'],['Trey McBride','TE','ARI']];
const blocks=teamNames.map((name,i)=>({team:{id:i?'team'+i:'mine',name:params.has('long')&&i===1?'The Incredibly Long Fantasy Team With No Short Name':name,owner_name:owners[i]},stats:{committed:100,dead_cap:25,unspent:75,by_position_count:{QB:1,RB:2,WR:2,TE:1}},roster:people.map(([player,pos,nfl],j)=>({player_id:`${i}-${j}`,player_name:params.has('long')&&j===0?'A Very Long Player Name With Several Surnames':player,position:pos,team:nfl,salary:10+j*2,contract_years:2,roster_status:'active',contract:{years_remaining:2}}))}));
if(params.has('more'))blocks.forEach((block,i)=>{for(let j=6;j<10;j++)block.roster.push({player_id:`${i}-${j}`,player_name:`Bench Receiver ${j}`,position:'WR',team:'BUF',salary:4,contract_years:1,roster_status:'active'});block.stats.by_position_count.WR+=4;});
const players=Object.fromEntries(blocks.flatMap((b,i)=>b.roster.map((r,j)=>[r.player_id,{remaining_points:100+j*14+i*8,annual_points:160+j*20+i*8}])));
if(state==='empty')blocks.splice(1);
blocks[0].roster.push({id:1000,player_id:'cut-player',player_name:'Former Player',position:'WR',salary:50,contract_years:2,roster_status:'cut_before_draft',dead_cap_amount:25,contract:{years_remaining:2}});
window.fixtureWrites=[];window.fixtureRequests=[];window.forecastReads=0;
window.fetch=async(input,options={})=>{
 const path=String(input);window.fixtureRequests.push(path);
 if(path.endsWith("/chat/summary"))return Response.json({members:[],threads:[],notifications:[],unread:3,preferences:{}});
 if(path.includes('/week?'))return Response.json({hub_context:{league_id:context.league_id,team_id:context.team_id},meta:{season:2026,week:6,projections_available:state!=='missing'},cards:state==='missing'?{}:Object.fromEntries(blocks.flatMap((block,i)=>block.roster.filter(r=>r.roster_status==='active').map((r,j)=>[r.player_id,{...r,p50:state==='zero'?0:10+j*2+i}]))),roster:{starters:[0,1,3,5,2].map((index,i)=>({ ...blocks[0].roster[index],slot:['QB','RB','WR','TE','FLEX'][i] }))}});
 if(path.endsWith('/trade-outlook')){
  window.forecastReads++;
  if(state==='forecast-error')return Response.json({detail:'Forecast service unavailable'},{status:503});
  return Response.json({players:state==='missing'||(state==='recovering'&&window.forecastReads===1)?{}:players,
   missing_player_ids:state==='missing'?['0-0']:[],
   recovery:{status:state==='recovering'&&window.forecastReads===1?'queued':'idle'},
   stale:state==='saved',basis:'PPR',week:4,season:2026});
 }
 if(path.includes('/rosters')){
  if(state==='loading')return new Promise(()=>{});
  if(state==='error')return Response.json({detail:'Roster service unavailable'},{status:503});
  return Response.json({league:{season:2026,draft_completed:true,rules},teams:blocks,salary_cap:200});
 }
 if(path.includes('/identities'))return Response.json({identities:Object.fromEntries(blocks.map((b,i)=>[b.team.id,{banner_preset:['midnight','stadium','sunset'][i%3],photo_preset:'shield'}]))});
 if(options.method==='POST'){
  const body=JSON.parse(options.body||'{}');window.fixtureWrites.push({path,body});
  if(body.validate_only&&params.has('validateDelay'))await new Promise(resolve=>setTimeout(resolve,Number(params.get('validateDelay'))));
  return Response.json(body.validate_only?{ok:state!=='invalid',errors:state==='invalid'?['Your team is over the cap.']:[],salary_cap:200}:{proposal_id:'preview'});
 }
 if(path.includes('/trades?'))return Response.json({proposals:state==='sleeper'||state==='review'?[{id:'sleeper-proposal',status:state==='review'?'cap_review':'awaiting_sleeper',parties:[{team_id:'mine',sends:[{player_id:'0-0',to_team_id:'team1'}],drops:[]},{team_id:'team1',sends:[{player_id:'1-0',to_team_id:'mine'}],drops:[]}],acceptances:{mine:'accepted',team1:'accepted'}}]:[]});
 if(path.includes('/insights'))return state==='slow-ideas'?new Promise(()=>{}):Response.json({trade:{suggestions:[]}});
 return Response.json({});
};
function Preview(){
 const mobile=useMobileLayout(),[picker,setPicker]=useState(false),[more,setMore]=useState(false),[scope,setScope]=useState(false),[revision,setRevision]=useState(0);
 const previewContext={...context,league_id:scope?'trades-other-fixture':context.league_id};
 const navigate=id=>{window.fixtureDestination=id;setPicker(false);};
 return <CommunicationProvider enabled={params.has("chat")} identity="trades-anchor-fixture" hubContext={previewContext}><LeagueChromeProvider><MobileShell className="app--compact-league" section="hub" onSectionChange={navigate} onMoreOpen={()=>setMore(true)} hrefForSection={id=>'#'+id}>
 <a className="app-skip-link" href="#main-content">Skip to content</a><header className="app-header app-header--hub app-header--product app-header--compact-league"><div className="app-header-shell app-header-shell--hub">
 <MobileHeader title="Trades" hasMenu menuOpen={picker} onTitleClick={()=>setPicker(true)} compactLeague onMoreOpen={()=>setMore(true)}/>
 <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{id:'projections',label:'Projections'},{id:'hub',label:'Fantasy'},{id:'tools',label:'Tools'}]} view="hub" pathForSection={id=>'#'+id} onNavigate={navigate}/>
 <HubSubnav subView="trades" hubContext={context} onNavigate={navigate} mobileLayout={mobile} pickerOnly={mobile} pickerOpen={picker} onPickerOpenChange={setPicker}/>
 </div></header><main id="main-content">{state==='scope'&&<button type="button" onClick={()=>setScope(true)}>Switch fixture league</button>}{state==='revision'&&<button type="button" onClick={()=>setRevision(value=>value+1)}>Refresh fixture projections</button>}<div className="draft-hub"><TeamIdentityProvider leagueId={previewContext.league_id}>
 <LeagueContextBanner hubContext={context} memberships={[{league_id:context.league_id,league_name:context.league_name,team:{id:'mine',name:'Sunday Roster'}}]} onLeagueSwitch={()=>{}} onCreateLeague={()=>{}} showAttention={false} currentView="trades"/>
 <LeagueTrades key={`${previewContext.league_id}:${previewContext.team_id}`} leagueId={previewContext.league_id} hubContext={previewContext} onNavigate={navigate} cacheScope="fixture" revisionToken={revision} onChanged={()=>{window.fixtureChanges=(window.fixtureChanges||0)+1;}}/>
 </TeamIdentityProvider></div></main><MobileMenuSheet open={more} onClose={()=>setMore(false)} authReady authenticated user={{name:'Maya Chen'}} onGoToAccount={()=>navigate('account')} view="hub"/>
 {params.has("chat")&&<><ChatLauncher leagueId={previewContext.league_id}/><CommunicationPanel/></>}</MobileShell></LeagueChromeProvider></CommunicationProvider>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Preview/></MemoryRouter>);
