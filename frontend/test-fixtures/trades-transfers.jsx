// Production trade components with isolated, deterministic writes; never contacts a league.
import React, {useState} from "react";
import LeagueContextBanner from "../src/DraftHub/LeagueContextBanner";
import {LeagueChromeProvider} from "../src/DraftHub/leagueChromeContext";
import MobileHeader from "../src/layout/MobileHeader";
import MobileShell from "../src/layout/MobileShell";
import MobileMenuSheet from "../src/layout/MobileMenuSheet";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import useMobileLayout from "../src/useMobileLayout";
import { createRoot } from "react-dom/client";
import LeagueTrades from "../src/DraftHub/LeagueTrades";
import HubSubnav from "../src/DraftHub/HubSubnav.jsx";
import {MemoryRouter} from "react-router-dom";
import {TeamIdentityProvider} from "../src/DraftHub/TeamIdentityContext";
import "../src/styles/fantasy-header.css";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";


const params=new URLSearchParams(location.search),state=params.get('state')||'salary';
const salary=state!=='pick';
const rules={salary_cap:200,draft_type:salary?'auction':'snake',contracts:{cut_refund_pct:.5},roster:{qb:{starter:1},rb:{starter:1},wr:{starter:1},te:{starter:1},flex:{starter:1,positions:['RB','WR','TE']},k:{starter:0},def:{starter:0}}};
const context={mode:'league',league_id:'trades-fixture',team_id:state==='readonly'?'':'mine',owner_name:'Maya Chen',team_name:'Sunday Roster',league_name:'Bottom to Top',draft_completed:true,is_commissioner:false,rules,capabilities:{uses_salaries:salary,uses_contracts:salary}};
if(state==='sleeper'||state==='review')context.sleeper_league_id='sleeper-fixture';
const teamNames=['Sunday Roster','Sunday Rivals','Mountain Kings','Midnight Blitz','Fourth & Forever','Coastal Crew'];
const owners=['Maya Chen','Jordan Davis','Morgan Lee','Alex Rivera','Taylor Reed','Sam Carter'];
const people=[['Josh Allen','QB','BUF'],['James Cook','RB','BUF'],['Bijan Robinson','RB','ATL'],['DeVonta Smith','WR','PHI'],['CeeDee Lamb','WR','DAL'],['Trey McBride','TE','ARI']];
const blocks=teamNames.map((name,i)=>({team:{id:i?'team'+i:'mine',name:params.has('long')&&i===1?'The Incredibly Long Fantasy Team With No Short Name':name,owner_name:owners[i]},stats:{committed:100,dead_cap:25,unspent:75,by_position_count:{QB:1,RB:2,WR:2,TE:1}},roster:people.map(([player,pos,nfl],j)=>({player_id:`${i}-${j}`,player_name:params.has('long')&&j===0?'A Very Long Player Name With Several Surnames':player,position:pos,team:nfl,salary:10+j*2,contract_years:2,roster_status:'active',contract:{years_remaining:2}}))}));
const players=Object.fromEntries(blocks.flatMap((b,i)=>b.roster.map((r,j)=>[r.player_id,{remaining_points:100+j*14+i*8,annual_points:160+j*20+i*8}])));
if(state==='empty')blocks.splice(1);
blocks[0].roster.push({id:1000,player_id:'cut-player',player_name:'Former Player',position:'WR',salary:50,contract_years:2,roster_status:'cut_before_draft',dead_cap_amount:25,contract:{years_remaining:2}});
window.fixtureWrites=[];window.fixtureRequests=[];
window.fetch=async(input,options={})=>{
 const path=String(input);window.fixtureRequests.push(path);
 if(path.endsWith('/trade-outlook'))return Response.json({players:state==='missing'?{}:players,basis:'PPR',week:4,season:2026});
 if(path.includes('/rosters')){
  if(state==='loading')return new Promise(()=>{});
  if(state==='error')return Response.json({detail:'Roster service unavailable'},{status:503});
  return Response.json({league:{season:2026,draft_completed:true,rules},teams:blocks,salary_cap:200});
 }
 if(path.includes('/identities'))return Response.json({identities:Object.fromEntries(blocks.map((b,i)=>[b.team.id,{banner_preset:['midnight','stadium','sunset'][i%3],photo_preset:'shield'}]))});
 if(options.method==='POST'){
  const body=JSON.parse(options.body||'{}');window.fixtureWrites.push({path,body});
  return Response.json(body.validate_only?{ok:state!=='invalid',errors:state==='invalid'?['Your team is over the cap.']:[],salary_cap:200}:{proposal_id:'preview'});
 }
 if(path.includes('/trades?'))return Response.json({proposals:state==='sleeper'||state==='review'?[{id:'sleeper-proposal',status:state==='review'?'cap_review':'awaiting_sleeper',parties:[{team_id:'mine',sends:[{player_id:'0-0',to_team_id:'team1'}],drops:[]},{team_id:'team1',sends:[{player_id:'1-0',to_team_id:'mine'}],drops:[]}],acceptances:{mine:'accepted',team1:'accepted'}}]:[]});
 if(path.includes('/insights'))return Response.json({trade:{suggestions:[]}});
 return Response.json({});
};
function Preview(){
 const mobile=useMobileLayout(),[picker,setPicker]=useState(false),[more,setMore]=useState(false);
 const navigate=id=>{window.fixtureDestination=id;setPicker(false);};
 return <LeagueChromeProvider><MobileShell className="app--compact-league" section="hub" onSectionChange={navigate} onMoreOpen={()=>setMore(true)} hrefForSection={id=>'#'+id}>
 <a className="app-skip-link" href="#main-content">Skip to content</a><header className="app-header app-header--hub app-header--product app-header--compact-league"><div className="app-header-shell app-header-shell--hub">
 <MobileHeader title="Trades" hasMenu menuOpen={picker} onTitleClick={()=>setPicker(true)} compactLeague onMoreOpen={()=>setMore(true)}/>
 <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{id:'projections',label:'Projections'},{id:'hub',label:'Fantasy'},{id:'tools',label:'Tools'}]} view="hub" pathForSection={id=>'#'+id} onNavigate={navigate}/>
 <HubSubnav subView="trades" hubContext={context} onNavigate={navigate} mobileLayout={mobile} pickerOnly={mobile} pickerOpen={picker} onPickerOpenChange={setPicker}/>
 </div></header><main id="main-content"><div className="draft-hub"><TeamIdentityProvider leagueId={context.league_id}>
 <LeagueContextBanner hubContext={context} memberships={[{league_id:context.league_id,league_name:context.league_name,team:{id:'mine',name:'Sunday Roster'}}]} onLeagueSwitch={()=>{}} onCreateLeague={()=>{}} showAttention={false} currentView="trades"/>
 <LeagueTrades leagueId={context.league_id} hubContext={context} onNavigate={navigate}/>
 </TeamIdentityProvider></div></main><MobileMenuSheet open={more} onClose={()=>setMore(false)} authReady authenticated user={{name:'Maya Chen'}} onGoToAccount={()=>navigate('account')} view="hub"/>
 </MobileShell></LeagueChromeProvider>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Preview/></MemoryRouter>);
