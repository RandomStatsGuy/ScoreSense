// Production components with deterministic fixture data. No request reaches a real league.
import React from "react";
import { createRoot } from "react-dom/client";
import RulesWizard from "../src/DraftHub/RulesWizard";
import TeamSalarySheets from "../src/DraftHub/TeamSalarySheets";
import LeagueOffice from "../src/DraftHub/LeagueOffice";
import InsightsOverview from "../src/DraftHub/insights/InsightsOverview";
import { capabilitiesFromRules } from "../src/DraftHub/leagueCapabilities";
import { DEFAULT_RULES, mergeLeagueRules } from "../src/DraftHub/rulesPresentation";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";

const params = new URLSearchParams(location.search);
const page = params.get("page") || "rules";
const state = params.get("state") || "ready";
const rules = mergeLeagueRules({ ...DEFAULT_RULES, draft_type: state === "snake" ? "snake" : "auction" });
const context = { mode: "league", league_id: "fixture", league_name: "Sunday League", team_id: "mine", season: 2026, is_commissioner: true, rules, capabilities: capabilitiesFromRules(rules),
  ...(state === "linked" ? { sleeper_league_id: "linked-fixture" } : {}) };
const workspace = { name: "Sunday League", season: 2026, rules };
const player = (id, name, position, cap) => ({ row_id: id, player_name: name, position, cap_hit: cap, base_salary: cap, prior_salary: cap - 2, roster_status: "active", acquisition_type: "auction", source_kind: "file" });
const sheet = (owner, team, rows) => ({ owner_label: owner, team_name: team, rows, totals: { committed: rows.reduce((s,r) => s + r.cap_hit, 0), against_cap: rows.reduce((s,r) => s + r.cap_hit, 0), unspent: 200 - rows.reduce((s,r) => s + r.cap_hit, 0), dead_cap: 0 } });
const sheets = { available: state !== "empty", season_year: 2026, season: 2026, prior_season: 2025, seasons: [2026,2025], default_salary_cap: 200, data_source: "commissioner_files", team_sheets: [
  sheet("Maya Chen", "Fourth & Long", [player(1,"Justin Jefferson","WR",38), player(2,"Breece Hall","RB",29),player(3,"Jayden Daniels","QB",17)]),
  sheet("Jordan Lee", "Sunday Scaries", [player(4,"CeeDee Lamb","WR",36), player(5,"Trey McBride","TE",14)]),
] };
sheets.summary_matrix = sheets.team_sheets.map((s) => ({ owner_label: s.owner_label, team_name: s.team_name, seasons: {2026: s.totals} }));
const landing = { available: state !== "empty", seasons_included: [2024,2025], has_records: true,
  most_titles: { owner_name: "Maya Chen", team_name: "Fourth & Long", titles: 2 },
  champions: [{ season:2025, owner_name:"Maya Chen", team_name:"Fourth & Long", runner_up_owner_name:"Jordan Lee" }],
  scoring_leaders: [{ owner_name:"Maya Chen", team_name:"Fourth & Long", total_points:4812 },{ owner_name:"Jordan Lee", team_name:"Sunday Scaries",total_points:4377 }],
  record_leaders: [{ owner_name:"Maya Chen",team_name:"Fourth & Long",games:28,wins:20,losses:8,win_pct:.714 },{ owner_name:"Jordan Lee",team_name:"Sunday Scaries",games:28,wins:18,losses:10,win_pct:.643 }] };
window.fixtureWrites = [];
window.fetch = async (input, options = {}) => {
  const url = String(input);
  const method = options.method || "GET";
  if (method !== "GET") {
    window.fixtureWrites.push({ url, method, body: options.body instanceof FormData ? { file: options.body.get("file")?.name } : options.body ? JSON.parse(options.body) : {} });
    if (state === "write-error") return Response.json({ detail:"Fixture publication failed" }, { status:503 });
    if (method === "PATCH") {
      const id = Number(url.split("/").at(-1));
      const row = sheets.team_sheets.flatMap((s) => s.rows).find((r) => r.row_id === id);
      if (row) Object.assign(row, JSON.parse(options.body));
    }
    return Response.json({ ...workspace, saved: workspace });
  }
  if (state === "loading") await new Promise(() => {});
  if (state === "error") return Response.json({ detail:"Fixture unavailable" },{ status:503 });
  if (url.endsWith("/correction-context")) {
    const id = Number(url.split("/").at(-2));
    const row = sheets.team_sheets.flatMap((s) => s.rows).find((r) => r.row_id === id);
    return Response.json({ original: row, row, season_year:2026, source_kind:"fixture", historic_snapshot_revision:1 });
  }
  if (url.includes("team-salary-sheets")) return Response.json(sheets);
  if (url.endsWith("/members")) return Response.json({ teams: [{ id:"mine",name:"Fourth & Long",owner_name:"Maya Chen" }] });
  if (url.includes("contract-history?")) return Response.json({ rows:sheets.team_sheets.flatMap((s) => s.rows) });
  if (url.includes("delete-request")) return Response.json({ request:null });
  return Response.json({ teams:[],media:{} });
};
const readonly = state === "readonly";
const content = page === "salary" ? <TeamSalarySheets leagueId="fixture" isCommissioner={!readonly} />
  : page === "access" ? <LeagueOffice leagueId="fixture" hubContext={context} workspace={workspace} officeTab="access" />
  : page === "insights" ? <InsightsOverview landing={state === "loading" || state === "error" ? null : landing} loading={state === "loading"} error={state === "error" ? "Unavailable" : ""} ownerMap={{}} onOpenTab={(tab) => { window.fixtureDestination = tab; }} />
  : <RulesWizard workspace={workspace} hubContext={context} readOnlyRules={readonly} />;
createRoot(document.getElementById("root")).render(<div className="app"><main id="main-content"><div className="draft-hub">{content}</div></main></div>);
