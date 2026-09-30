// Production lineup components with isolated, deterministic writes; never contacts a league.
import React, {useState} from "react";
import LeagueContextBanner from "../src/DraftHub/LeagueContextBanner";
import {LeagueChromeProvider} from "../src/DraftHub/LeagueChromeContext";
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
const fixtureBanners=["<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"260\" viewBox=\"0 0 800 260\">\n<defs><linearGradient id=\"sky\" x2=\"0\" y2=\"1\"><stop stop-color=\"#1e3a5f\"/><stop offset=\"1\" stop-color=\"#070d17\"/></linearGradient><radialGradient id=\"glow\"><stop stop-color=\"#73a5ff\" stop-opacity=\".6\"/><stop offset=\"1\" stop-color=\"#73a5ff\" stop-opacity=\"0\"/></radialGradient></defs>\n<path fill=\"url(#sky)\" d=\"M0 0h800v260H0z\"/><ellipse cx=\"400\" cy=\"40\" rx=\"360\" ry=\"150\" fill=\"url(#glow)\"/>\n<path fill=\"#132238\" d=\"M0 110 400 172 800 110v150H0z\"/><g stroke=\"#32465e\" fill=\"none\"><path d=\"M0 133 400 187 800 133M0 153 400 203 800 153M0 174 400 219 800 174\"/></g>\n<path fill=\"#12352f\" d=\"m225 260 175-80 175 80z\"/><g stroke=\"#34d399\" opacity=\".35\"><path d=\"m273 247 254 0M305 233h190M338 218h124M370 204h61M400 183v77\"/></g>\n<g stroke=\"#90a6bf\" stroke-width=\"4\"><path d=\"M95 38v127M705 38v127\"/></g><g fill=\"#d3e3f7\"><path d=\"M65 31h60v12H65zM675 31h60v12h-60z\"/></g>\n</svg>\n", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"260\" viewBox=\"0 0 800 260\">\n<defs><linearGradient id=\"sky\" x2=\"0\" y2=\"1\"><stop stop-color=\"#253952\"/><stop offset=\"1\" stop-color=\"#09111d\"/></linearGradient></defs>\n<path fill=\"url(#sky)\" d=\"M0 0h800v260H0z\"/><circle cx=\"615\" cy=\"55\" r=\"27\" fill=\"#90a6bf\" opacity=\".65\"/>\n<path fill=\"#32465e\" d=\"m0 235 165-183 129 146L425 28l190 179L735 75l65 109v76H0z\"/><path fill=\"#9bacc0\" opacity=\".6\" d=\"m165 52-40 44 41-13 33 8zM425 28l-57 74 56-26 55 21zM735 75l-33 37 31-10 27 8z\"/>\n<path fill=\"#14263a\" d=\"m0 210 200-67 124 100L530 120l164 110 106-83v113H0z\"/><path fill=\"#070d17\" d=\"m0 238 165-37 205 57 130-40 300 20v22H0z\"/>\n</svg>\n", "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"800\" height=\"260\" viewBox=\"0 0 800 260\">\n<defs><linearGradient id=\"sky\" x2=\"0\" y2=\"1\"><stop stop-color=\"#233a56\"/><stop offset=\"1\" stop-color=\"#070d17\"/></linearGradient></defs>\n<path fill=\"url(#sky)\" d=\"M0 0h800v260H0z\"/><circle cx=\"660\" cy=\"58\" r=\"30\" fill=\"#73a5ff\" opacity=\".4\"/>\n<path fill=\"#132238\" d=\"M0 180h40V85h75v95h36V120h55v60h34V40h84v140h26V99h80v81h35V63h58v117h27V112h90v68h35V74h73v106h52v80H0z\"/>\n<g fill=\"#73a5ff\" opacity=\".38\"><path d=\"M56 100h13v8H56zM81 100h13v8H81zM256 57h15v9h-15zM286 57h15v9h-15zM256 85h15v9h-15zM286 85h15v9h-15zM480 80h12v9h-12zM504 80h12v9h-12zM662 92h14v8h-14zM686 92h14v8h-14z\"/></g>\n<path fill=\"#09111d\" d=\"M0 221q200-56 400-6t400-3v48H0z\"/><path fill=\"none\" stroke=\"#34d399\" stroke-opacity=\".2\" stroke-width=\"2\" d=\"M0 235q200-56 400-6t400-3\"/>\n</svg>\n"];
const context={mode:'league',league_id:'trades-fixture',team_id:state==='readonly'?'':'mine',owner_name:'Maya Chen',team_name:'Sunday Roster',league_name:'Bottom to Top',draft_completed:true,is_commissioner:false,rules,capabilities:{uses_salaries:salary,uses_contracts:salary}};
const teamNames=['Sunday Roster','Sunday Rivals','Mountain Kings','Midnight Blitz','Fourth & Forever','Coastal Crew'];
const owners=['Maya Chen','Jordan Davis','Morgan Lee','Alex Rivera','Taylor Reed','Sam Carter'];
const people=[['Josh Allen','QB','BUF'],['James Cook','RB','BUF'],['Bijan Robinson','RB','ATL'],['DeVonta Smith','WR','PHI'],['CeeDee Lamb','WR','DAL'],['Trey McBride','TE','ARI']];
const blocks=teamNames.map((name,i)=>({team:{id:i?'team'+i:'mine',name:params.has('long')&&i===1?'The Incredibly Long Fantasy Team With No Short Name':name,owner_name:owners[i]},stats:{committed:100,dead_cap:6,by_position_count:{QB:1,RB:2,WR:2,TE:1}},roster:people.map(([player,pos,nfl],j)=>({player_id:`${i}-${j}`,player_name:params.has('long')&&j===0?'A Very Long Player Name With Several Surnames':player,position:pos,team:nfl,salary:10+j*2,contract_years:2,roster_status:'active',contract:{years_remaining:2}}))}));
const players=Object.fromEntries(blocks.flatMap((b,i)=>b.roster.map((r,j)=>[r.player_id,{remaining_points:100+j*14+i*8,annual_points:160+j*20+i*8}])));
if(state==='empty')blocks.splice(1);
window.fixtureWrites=[];window.fixtureRequests=[];
window.fetch=async(input,options={})=>{
 const path=String(input);window.fixtureRequests.push(path);
 if(path.endsWith('/trade-outlook'))return Response.json({players:state==='missing'?{}:players,basis:'PPR',week:4,season:2026});
 if(path.endsWith('/rosters')){
  if(state==='loading')return new Promise(()=>{});
  if(state==='error')return Response.json({detail:'Roster service unavailable'},{status:503});
  return Response.json({league:{season:2026,draft_completed:true,rules},teams:blocks,salary_cap:200});
 }
 if(path.includes('/identities'))return Response.json({identities:Object.fromEntries(blocks.map((b,i)=>[b.team.id,{banner_preset:'navy_stripe',photo_preset:'gridiron',banner_url:'data:image/svg+xml,'+encodeURIComponent(fixtureBanners[i%3]),banner_focus:{x:60,y:50,zoom:1.1}}]))});
 if(options.method==='POST'){
  const body=JSON.parse(options.body||'{}');window.fixtureWrites.push({path,body});
  return Response.json(body.validate_only?{ok:state!=='invalid',errors:state==='invalid'?['Your team is over the cap.']:[],salary_cap:200}:{proposal_id:'preview'});
 }
 if(path.includes('/trades?'))return Response.json({proposals:[]});
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
