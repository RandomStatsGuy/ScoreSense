import '../src/styles.css';
import '../src/styles/product-hierarchy.css';
import '../src/styles/projections-experience.css';
import '../src/styles/product-rhythm.css';
import '../src/styles/fantasy-phone.css';
import '../src/styles/fantasy-header.css';
import '../src/styles/standalone-dialogs.css';
import '../src/styles/color-theme.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import App from '../src/App';
import {AuthContext} from '../src/AuthContext';
import {AppearanceProvider} from '../src/AppearanceProvider';

// Full production App and player card; every request stays in fixture memory.
const params=new URLSearchParams(location.search), state=params.get('state')||'ready';
window.scoreSenseTheme.set(params.get('theme')||'dark');
const preseason=location.pathname.includes('/preseason')||params.get('view')==='preseason';
const boardPosition=params.get('pos')||(['mixed','bye'].includes(state)?'wr':'rb');
const scores=[30,26,23.5,18,17.9,12,11.5,9,8.5,6.1,6,5.9,5,4,3,2,1,.5,.1,0,-.2,null];
const names=['Bijan Robinson','Jahmyr Gibbs','Saquon Barkley',"De’Von Achane",'Jonathan Taylor','James Cook','Christian McCaffrey','Breece Hall','Derrick Henry','Josh Jacobs','Kyren Williams','Isiah Pacheco'];
let rows=scores.map((p,i)=>({player_id:`p${i}`,Player:names[i]||`Player ${i+1}`,Team:['ATL','DET','PHI','MIA','IND','BUF','SF','NYJ','BAL','GB','LAR','KC'][i%12],Position:'RB',Opponent:'BUF',
  'Projected Points':p,'Low (P10)':p==null?null:p-3,'High (P90)':p==null?null:p+5,
  'Injury Status':i===7?'Questionable':'',previous_rank:i+2,current_rank:p==null?null:i+1,rank_delta:i%3===0?2:0,
  'Per-Game Proj':p,'Season Proj':p==null?null:p*17,'Season Floor':p==null?null:(p-3)*17,'Season Ceiling':p==null?null:(p+5)*17,
  season_quantile_method:'mc_schedule_v1','Reg Season Pts':p==null?null:p*4.6,'Games Played':5,'Games Remaining':10,'Weeks Remaining':10,
  'Next Week P50':p,'ROS P50':p==null?null:p*10,'Season P50':p==null?null:p*14.6,'Season P90':p==null?null:(p+5)*14.6}));
if(state==='large')rows[0]={...rows[0],Player:'Alexandria Montgomery Johnson with a very long player name','Projected Points':9999.9,'Low (P10)':999.9,'High (P90)':19999.9,'Season Proj':99999.9,'Season P50':99999.9,'Season Floor':79999.9,'Season P90':119999.9,'ROS P50':99999.9,'Reg Season Pts':9999.9};
if(state==='missing')rows=rows.slice(0,4).map(row=>({...row,'Projected Points':null,'Low (P10)':null,'High (P90)':null,'Per-Game Proj':null,'Season Proj':null,'Season Floor':null,'Season Ceiling':null,'ROS P50':null,'Season P50':null}));
if(state==='long')rows=rows.slice(0,10).concat(Array.from({length:800},(_,i)=>({...rows[10],player_id:`tail${i}`,Player:i===799?'Last zero-point player':`Depth player ${i+1}`,'Projected Points':i===799?0:6-i/200,'Per-Game Proj':i===799?0:6-i/200,'Season Proj':i===799?0:(6-i/200)*17,'ROS P50':i===799?0:(6-i/200)*10,'Season P50':i===799?0:(6-i/200)*14.6})));
if(state==='ready')rows.push({...rows[1],player_id:'out',Player:'Injured player','Injury Status':'Out'});
if(state==='industry')rows=rows.slice(0,5).map((row,i)=>{
 const total=[370.4,353.2,331.2,0,null][i],pace=total==null?null:total/17;
 return {...row,Team:['DET','ATL','SF','ATL','DET'][i],Player:['Jahmyr Gibbs','Bijan Robinson','Christian McCaffrey','Zero forecast','Missing forecast'][i],
  'Projected Points':pace,'Low (P10)':pace==null?null:pace-3,'High (P90)':pace==null?null:pace+5,
  'Per-Game Proj':pace,'Season Proj':total,'Season P50':total,'Season Floor':total==null?null:total*.8,'Season P90':total==null?null:total*1.2,
  'ROS P50':pace==null?null:pace*10};
});
if(state==='mixed')rows=rows.slice(0,8).map((row,i)=>{
 const points=[19.9,15.3,15.3,11,0,-1,25,null][i],actual=['WR','TE','WR','TE','WR','TE',null,'WR'][i];
 return {...row,Position:actual,p50_delta:[.4,.6,-.3,.2,0,0,null,null][i],Player:['WR leader','TE leader','WR same points','TE depth','Zero WR','Negative TE','Unknown position','Missing forecast'][i],
  'Projected Points':points,'Low (P10)':points==null?null:points-3,'High (P90)':points==null?null:points+5,
  'Per-Game Proj':points,'Season Proj':points==null?null:points*17,'Season Floor':points==null?null:(points-3)*17,'Season P90':points==null?null:(points+5)*17,
  'Season P50':points==null?null:points*17,'ROS P50':points==null?null:points*10};
});
if(state==='seasonTotals')rows=rows.slice(0,2).map((row,i)=>({...row,Player:i?'Low weekly, strong season':'High weekly, small season',
 'Projected Points':i?5:30,'Per-Game Proj':i?5:30,'Season Proj':i?360:80,'Season P50':i?360:80,'Season Floor':i?288:64,'Season P90':i?432:96}));
if(state==='bye')rows=rows.slice(0,3).map((row,i)=>({...row,Position:'WR',
 Player:['Amon-Ra St. Brown','Justin Jefferson','Active receiver'][i],Team:['DET','MIN','CIN'][i],Opponent:i<2?'BYE':'BUF',
 'Projected Points':[40,35,19.9][i],'Low (P10)':[30,25,12][i],'High (P90)':[50,45,27][i]}));
if(state==='empty')rows=[];
window.fixtureRows=rows;
window.fixtureWrites=[];window.fixtureRequests=[];
const avatar=name=>`./fixture-avatar.svg?name=${encodeURIComponent(name.split(/\s+/).map(n=>n[0]).slice(0,2).join(''))}`;
const json=data=>Response.json(data);
window.fetch=async(input,options={})=>{
 const url=new URL(String(input),location.origin),path=url.pathname;
 window.fixtureRequests.push(path);
 if (/^\/api\/(?:predict|draft|ros|meta\/(?:projections|draft)|fantasy-narrative)\/te(?:\/|$)/.test(path)) return Response.json({detail:'TE uses the shared WR artifact'},{status:400});
 if(options.method&&!['GET','HEAD'].includes(options.method))window.fixtureWrites.push({path,method:options.method});
 if(path.includes('/card')) {
  const id=path.split('/').at(-2), row=rows.find(r=>r.player_id===id)||rows[0];
  return json({player_id:id,name:row?.Player,team:row?.Team,position:row?.Position,media:{headshot_url:avatar(row?.Player||'Player')},
   weekly_projection:row,rest_of_season_projection:{p10:100,p50:180,p90:260,games_remaining:10},
   preseason_projection:{p10:200,p50:310,p90:400},preseason_baseline:{points:310,games:17},
   season_to_date:{season:2026,points:row?.['Reg Season Pts'],ppg:row?.['Reg Season Pts']/5,games_played:5,through_week:5,complete:true},
   game_log:[1,2,3,4,5].map(week=>({week,opponent:'BUF',rushing_yards:90,receiving_yards:30,touchdowns:1,points:row?.['Reg Season Pts']/5})),game_log_season:2026,
   injury:row?.['Injury Status']==='Questionable'?{injury_status:'Questionable',injury_body_part:'Ankle'}:null,
   meta:{season:2026,week:6,preseason_mode:preseason,built_at:new Date().toISOString()}});
 }
 if(path.startsWith('/api/meta/projections'))return json({default_season:2026,default_week:6,preseason_mode:preseason,seasons:[2026],weeks_by_season:{2026:Array.from({length:18},(_,i)=>i+1)}});
 if(path.startsWith('/api/meta/draft'))return json({default_season:2026,seasons:[2026]});
 if(path.includes('/changes'))return json({changes:[],available:true});
 if(path.startsWith('/api/predict')||path.startsWith('/api/draft/')||path.startsWith('/api/ros/')) {
  if(state==='loading')return new Promise((resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
  if(state==='error')return Response.json({detail:'Fixture projections unavailable'},{status:503});
  return json({projections:rows,meta:{season:2026,week:6,projection_week:6,weeks_remaining:state==='complete'?0:10,season_complete:state==='complete',season_quantile_method:'mc_schedule_v1',built_at:new Date().toISOString(),projection_movement:{available:state!=='noMovement'}}});
 }
 if(path==='/api/players/media')return json({media:Object.fromEntries(rows.map(row=>[row.player_id,{headshot_url:avatar(row.Player)}]))});
 if(path==='/api/players/context')return json({players:[],available:true,meta:{updated_at:new Date(Date.now()-(state==='stale'?7200000:0)).toISOString(),stale:state==='stale'}});
 if(path.includes('/explanation'))return json({note:'Projection signals are derived from ScoreSense weekly artifacts and processed usage features. Narrative context is separate overlay and does not enter the projection model.',
  projection_signals:[{id:'usage',label:'Recent usage',detail:'Recent target share is elevated.',direction:'up',strength:'high'},
   {id:'uncertainty',label:'Elevated uncertainty',detail:'A wider range of outcomes.',direction:'down',strength:'high'}],
  narrative_context:{available:false,disclaimer:'Context overlay · not a model input'}});
 if(path.startsWith('/api/accuracy'))return json({summary:{scoresense_avg_mae:4.4}});
 if(path.includes('/context'))return json({player_id:'p0',this_week:state==='bye'?{projection_line:'Week is 0.2 above the healthy slate.'}:{detail:'Full practice on Friday.',source:'Practice report',projection_line:'Week is 0.2 above the healthy slate.'},meta:{season:2026,week:6},media_context:{state:'none'}});
 if(path==='/api/hub/prefs')return json({theme:params.get('theme')||'light',appearance:{}});
 if(path==='/api/hub/workspace')return json({roster:[],hub_context:{mode:'practice'}});
 if(path==='/api/hub/context')return json({mode:'practice'});
 if(path.includes('memberships'))return json({memberships:[]});
 if(path.includes('refresh/status'))return json({automatic:true,running:false,phase:'idle',last_success_at:new Date().toISOString()});
 if(path.includes('sentiment'))return json({players:[],meta:{}});
 if(path.includes('site-notice'))return json({enabled:false});
 return json({items:[],threads:[],unread_count:0,notifications:[],players:[],meta:{}});
};
const auth={ready:true,authenticated:true,user:{name:'Preview manager',sub:'fixture',is_admin:false,email_verified:true},hubAuthRequired:false,openSignIn:()=>{},logout:()=>{},refreshAuth:async()=>{}};
const route=params.get('view')==='preseason'?'/projections/season/preseason':params.get('view')==='live'?'/projections/season/live':location.pathname.startsWith('/projections/')?location.pathname:'/projections/weekly';
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[`${route}?pos=${boardPosition}&season=2026&week=6&draftSeason=2026&fromWeek=6`]}><AuthContext.Provider value={auth}><AppearanceProvider><aside style={{padding:"var(--space-2)",fontSize:"var(--text-xs)",textAlign:"center",color:"var(--text-muted)"}}>Implementation preview · example player data</aside><App/></AppearanceProvider></AuthContext.Provider></MemoryRouter>);
