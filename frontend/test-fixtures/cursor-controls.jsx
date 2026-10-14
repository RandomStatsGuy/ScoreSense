// Isolated production draft controls: no league, socket, or production writes.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DraftLiveCommandBar from "../src/DraftHub/DraftLiveCommandBar.jsx";
import DraftPlayerRail from "../src/DraftHub/DraftPlayerRail.jsx";
import DraftOverflowMenu from "../src/DraftHub/DraftOverflowMenu.jsx";
import DraftSeat from "../src/DraftHub/DraftSeat.jsx";
import HoverTip from "../src/HoverTip.jsx";
import QuantileBar from "../src/QuantileBarShared.jsx";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/tools-draft.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";

window.fetch = async () => new Response(JSON.stringify({media:{}}), {headers:{"Content-Type":"application/json"}});
const rows = [
  {player_id:"fixture-qb",player:"Sample Quarterback",position:"QB",team:"BUF",season_proj:300,per_game_proj:18,fair_value:20,min_sal:15,max_sal:25},
  {player_id:"fixture-rb",player:"Sample Running Back",position:"RB",team:"KC",season_proj:250,per_game_proj:15,fair_value:30,min_sal:20,max_sal:40},
];
function Fixture() {
  const [status,setStatus]=useState("bidding");
  const [paused,setPaused]=useState(false);
  const [amount,setAmount]=useState("21");
  const [selected,setSelected]=useState("");
  const [message,setMessage]=useState("");
  const nominee={player_id:"fixture-qb",player_name:"Sample Quarterback",position:"QB",team:"BUF"};
  const pick=status==="picking";
  return <main id="main-content" className="hub-page" style={{padding:"var(--space-4)"}}>
    <h1>Draft cursor fixture</h1>
    <div>{["nominating","bidding","picking"].map(phase=><button key={phase} aria-pressed={status===phase} onClick={()=>setStatus(phase)}>{phase}</button>)}</div>
    <label><input type="checkbox" checked={paused} onChange={e=>setPaused(e.target.checked)}/>Paused</label>
    <DraftLiveCommandBar session={{status,high_bid:20,high_bidder_team_id:"other"}} nominee={status==="bidding"?nominee:null}
      myTeamId="mine" myBudget={200} myMaxBid={190} suggestedBid={21} minBid={1} bidAmount={amount}
      onBidAmountChange={setAmount} onBid={()=>setMessage("Fixture bid clicked")}
      isCommissioner canAward onAward={()=>setMessage("Fixture award clicked")}
      nominatorTeam={{name:"Viewer"}} nextNominatorTeam={{name:"Other manager"}}
      isMyNominationTurn connectionStatus="live" paused={paused} canResume={paused} onResume={()=>setPaused(false)}
      pickDraft={pick} leagueLabel="Isolated fixture"/>
    <DraftPlayerRail rows={rows} pickDraft={pick} selectedPlayerId={selected} needPositions={["QB","RB"]}
      onSelectPlayer={row=>setSelected(row.player_id)} onDraftPlayer={()=>setMessage("Fixture player chosen")}
      onQueuePlayer={()=>setMessage("Fixture queue clicked")} onWatchPlayer={()=>setMessage("Fixture star clicked")}
      canDraft={!paused} showDraftAction paused={paused}/>
    <DraftOverflowMenu><button onClick={()=>setMessage("Fixture overflow clicked")}>Fixture menu action</button></DraftOverflowMenu>
    <DraftSeat slot={1} name="Viewer" mine taken onClick={()=>setMessage("Fixture seat clicked")}/>
    <HoverTip content="Extra information"><span>Hover information</span></HoverTip>
    <QuantileBar p10={10} p50={20} p90={30} scaleMax={40}/>
    <button disabled>Unavailable control</button><input aria-label="Text entry" title="Enter a name"/>
    <output aria-live="polite">{message}</output>
  </main>;
}
createRoot(document.getElementById("root")).render(<Fixture/>);
