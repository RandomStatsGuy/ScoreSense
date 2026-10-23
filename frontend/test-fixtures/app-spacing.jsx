// Real pages with synthetic data, isolated from account and league storage.
import React from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {AuthContext} from "../src/AuthContext";
import WeeklyTable from "../src/WeeklyTable";
import DraftTable from "../src/DraftTable";
import BestBallBoard from "../src/BestBallBoard";
import AccuracyChart from "../src/AccuracyChart";
import HubSetup from "../src/DraftHub/HubSetup";
import DraftEntryPanel from "../src/DraftHub/DraftEntryPanel";
import {HubPage, HubAlertStack, HubAlert} from "../src/DraftHub/HubUILayout";
import MockDraftTool from "../src/DraftHub/MockDraftTool";
import LandingPage from "../src/LandingPage";
import {ProjectionBoardDisclosure} from "../src/ProjectionBoardChrome";
import InjurySidebar from "../src/InjurySidebar";
import PrivacyPage from "../src/legal/PrivacyPage";
import TermsPage from "../src/legal/TermsPage";
import SmsAlertsPage from "../src/legal/SmsAlertsPage";
import "../src/styles.css";
import "../src/styles/color-theme.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/projections-experience.css";
const params=new URLSearchParams(location.search),view=params.get('view')||'weekly';
const rows=['Josh Allen','Patrick Mahomes','Jalen Hurts','Jayden Daniels'].map((Player,i)=>({Player,player_id:`sample-${i}`,Team:['BUF','KC','PHI','WAS'][i],Opponent:'NYJ',Position:'QB','Projected Points':22-i,'Low (P10)':12-i,'High (P90)':31-i,'Season Proj':340-i*20,'Per-Game Proj':20-i,'Season Floor':230-i*10,'Season Ceiling':450-i*10,model_rank:i+1,ecr_rank:i+2,adp:i+1,season_points:340-i*20}));
window.fixtureWrites=[];
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.origin);
 if(!url.pathname.startsWith('/api/'))return originalFetch(input,options);
 if((options.method||'GET')!=='GET'){window.fixtureWrites.push(url.pathname);return Response.json({detail:'Fixture writes blocked'},{status:409});}
 if(url.pathname==='/api/bestball/board')return Response.json({players:rows,meta:{season:2026,with_adp:4}});
 if(url.pathname.includes('mock')&&url.pathname.includes('formats'))return Response.json({formats:[]});
 return Response.json({identities:{},media:{},players:[],teams:[],rules:{},rows:[],recent:[],presets:[],memberships:[]});
};
const context={mode:'league',league_id:'sample',team_id:'mine',season:2026,is_commissioner:true,draft_completed:false};
const report={seasons:[2024,2025],position:'qb',series:{scoresense:[3.2,3.1],site_composite:[3.4,3.3]},summary:{scoresense_avg_mae:3.15,site_composite_avg_mae:3.35}};
const auth={ready:true,authenticated:view==='mock',user:view==='mock'?{auth_type:'native',email_verified:true,name:'Sample manager'}:null,googleConfigured:true,refreshAuth:async()=>{}};
const board=<><ProjectionBoardDisclosure title="Injury report" summary="Availability and player opportunities"><InjurySidebar players={[]} /></ProjectionBoardDisclosure><ProjectionBoardDisclosure title="Projection notes" summary="How to use the range"><p>Illustrative fixture data. Forecasts are estimates.</p></ProjectionBoardDisclosure></>;
const pages={weekly:<><WeeklyTable rows={rows} search="" teamsFilter={[]} position="qb" season={2026} week={7}/>{board}</>,season:<><DraftTable rows={rows} search="" position="qb" season={2026}/>{board}</>,bestball:<BestBallBoard/>,accuracy:<AccuracyChart report={report}/>,setup:<HubSetup hubContext={context} workspace={{season:2026,rules:{}}} memberships={[]} roster={[]}/>,mock:<MockDraftTool hubContext={context}/>,privacy:<PrivacyPage/>,terms:<TermsPage/>,sms:<SmsAlertsPage/>};
pages.entry=<DraftEntryPanel hubContext={context} league={{id:'sample',name:'Sample league',season:2026,rules:{salary_cap:200,team_count:6}}} rules={{salary_cap:200,team_count:6}} teams={[]} />;
pages.alerts=<HubPage stack><h1>Alert spacing fixture</h1><HubAlertStack>{false}{null}{undefined}{[]}</HubAlertStack><section data-alert-content>Content after an empty alert slot</section><HubAlertStack><HubAlert variant="warn">A visible warning stays available.</HubAlert></HubAlertStack></HubPage>;
const landing=view.startsWith('landing'),route=view==='landing'?'/' :view==='landing-projections'?'/projections':view==='landing-fantasy'?'/fantasy':'/tools';
createRoot(document.getElementById('root')).render(<AuthContext.Provider value={auth}><MemoryRouter initialEntries={[landing?route:'/']}>
 {landing?<LandingPage/>:<main id="main-content" className="app-spacing-fixture" style={{maxWidth:1440,margin:'auto',padding:'var(--space-4)'}}>{pages[view]}</main>}
</MemoryRouter></AuthContext.Provider>);
