// Production supporting pages with synthetic API responses; no account/league writes.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthContext } from "../src/AuthContext";
import AuthSessionPage from "../src/AuthSessionPage";
import { AuthCallbackPage, AuthForgotPasswordPage, AuthResetPasswordPage, AuthVerifyPage } from "../src/AuthPages";
import AccountSettingsPage from "../src/AccountSettingsPage";
import BugReportPage from "../src/BugReportPage";
import AdminPortal from "../src/AdminPortal";
import WeekCorrections from "../src/DraftHub/WeekCorrections";
import WeeklyCommandCenter from "../src/DraftHub/WeeklyCommandCenter";
import VibeRankings from "../src/DraftHub/VibeRankings";
import LobbyJoinPage from "../src/DraftHub/LobbyJoinPage";
import SharedTeamRoom from "../src/DraftHub/SharedTeamRoom";
import LeagueCreateJoinDialog from "../src/DraftHub/LeagueCreateJoinDialog";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/standalone-dialogs.css";
import "../src/styles/color-theme.css";

const params = new URLSearchParams(location.search);
const view = params.get("view") || "login";
window.fixtureState = params.get("state") || "ready";
window.fixtureWrites = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, options = {}) => {
  const url = String(input);
  if (!url.startsWith("/api/")) return originalFetch(input, options);
  if (window.fixtureState === "loading") return new Promise(() => {});
  if ((options.method || "GET") !== "GET") {
    window.fixtureWrites.push({ path: url, body: JSON.parse(options.body || "{}") });
    if (url.includes("/corrections/") && url.endsWith("/preview")) {
      const standings=[{team_id:"sample",name:"Sample team",wins:1,losses:0,ties:0}];
      return Response.json({id:"sample-preview",revision:1,reason:JSON.parse(options.body).reason,can_publish:true,blockers:[],before:{scores:[{team_id:"sample",points:10}],standings},after:{scores:[{team_id:"sample",points:20}],standings}});
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    return window.fixtureState === "error"
      ? Response.json({ detail: "Could not save the sample change. Try again." }, { status: 503 })
      : Response.json({ ok: true, key: "SCORE-FIXTURE", user: { name: "Sample manager" }, message: "Saved" });
  }
  if (url.includes("/api/support/bugs/status")) return Response.json({ enabled: true });
  if (url.includes("/corrections/")) return Response.json({revision:1,teams:[{id:"sample",name:"Sample team"}],lineups:[{team_id:"sample",player_id:"sample-allen",player_name:"Josh Allen",nfl_team:"BUF",position:"QB",slot:"QB1"}],slots:{QB:1},history:[]});
  if (url.startsWith("/api/hub/week")) return Response.json({meta:{season:2026,week:6},status:{empty_roster:true,unlinked_league:true},starters:[],bench:[],counts:{roster:0},sync:{linked:false},hub_context:{mode:"league",league_id:"sample",team_id:"sample",team_name:"Sample manager",draft_completed:false}});
  if (url.includes("/api/admin/overview")) return Response.json({ native_user_count:1,live_league_count:1,test_league_count:0,bot_sub_count:11 });
  if (url.includes("/api/admin/users")) return Response.json({ accounts:[{user_sub:"sample",email:"sample@example.test",display_name:"Sample manager",auth_type:"native",memberships:[]}],system_subs:[] });
  if (url.includes("/api/admin/leagues")) return Response.json({ leagues:[{id:"sample",name:"Sample league",room_code:"SAMPLE",season:2026,team_count:12,teams:[{id:"open",name:"Open team",user_sub:null}]}] });
  if (url.includes("/api/hub/prefs")) return Response.json({ prefs: { atmosphere: "none" } });
  if (url.includes("/api/hub/lobby/")) {
    if (window.fixtureState === "invalid") return Response.json({ detail: "This sample lobby is unavailable." }, { status: 404 });
    return Response.json({ name: "Sample practice room", league_id: "sample", test_mode: true, can_walk_in: window.fixtureState !== "full", can_join: window.fixtureState !== "full", status: "setup", claimed: 3, team_count: 12, season: 2026, draft_type: "auction" });
  }
  if (url.includes("/api/hub/shared-room/")) {
    if (window.fixtureState === "invalid") return Response.json({ detail: "This sample share link has expired." }, { status: 404 });
    return Response.json({ team: { id: "sample", name: "Sample room", owner_name: "Sample manager" }, starters: [], bench: [], state: "pregame", week: 6, season: 2026, can_edit: false, theme: "none" });
  }
  return Response.json({});
};
function CreateJoinPreview() {
  const [open, setOpen] = useState(false);
  return <><main id="main-content"><button className="btn-ghost" onClick={() => setOpen(true)}>Open create or join</button></main><LeagueCreateJoinDialog open={open} onClose={() => setOpen(false)} season={2026} /></>;
}
function AdminPreview() {
  const [tab,setTab] = useState("overview");
  return <main id="main-content"><AdminPortal adminTab={tab} onAdminTabChange={setTab} /></main>;
}
function CallbackDestination() {
  const current=useLocation();
  return <main id="main-content"><h1>Sample return destination</h1><p data-fixture-return>{current.pathname}{current.search}</p></main>;
}
const route = view === "callback" ? `/auth/callback?token=sample-callback&next=${encodeURIComponent(window.fixtureState==="unsafe"?"https://example.test/":"/hub/home?week=6")}`
  : view === "reset" ? `/auth/reset-password${window.fixtureState === "missing" ? "" : "?token=sample"}`
  : view === "verify" ? `/auth/verify?${window.fixtureState === "success" ? "success=1" : window.fixtureState === "error" ? "error=expired" : ""}`
  : view === "lobby" ? "/lobby/SAMPLE" : view === "room" ? "/team-room/sample" : `/${view}`;
const auth = { ready: true, authenticated: ["account", "report"].includes(view), user: { auth_type: "native", email: "sample@example.test", email_verified: true, name: "Sample manager", has_password: true }, googleConfigured: true, patreonConfigured: false, termsUrl: "/terms", privacyUrl: "/privacy", refreshAuth: async () => {} };
const pages = { login: <AuthSessionPage />, register: <AuthSessionPage mode="register" />, forgot: <AuthForgotPasswordPage />, reset: <AuthResetPasswordPage />, verify: <AuthVerifyPage />, account: <AccountSettingsPage />, report: <BugReportPage />, create: <CreateJoinPreview />, admin:<AdminPreview />, corrections:<main id="main-content"><WeekCorrections leagueId="sample" season={2026} /></main>, week:<main id="main-content"><WeeklyCommandCenter hubContext={{mode:"league",league_id:"sample",team_id:"sample",draft_completed:false}} /></main>, vibes:<main id="main-content"><VibeRankings hubContext={{mode:"solo"}} /></main> };
createRoot(document.getElementById("root")).render(<AuthContext.Provider value={auth}><MemoryRouter initialEntries={[route]}><Routes><Route path="/auth/callback" element={<AuthCallbackPage />} /><Route path="/lobby/:roomCode" element={<LobbyJoinPage />} /><Route path="/team-room/:token" element={<SharedTeamRoom />} /><Route path="*" element={view==="callback"?<CallbackDestination />:pages[view] || pages.login} /></Routes></MemoryRouter></AuthContext.Provider>);
