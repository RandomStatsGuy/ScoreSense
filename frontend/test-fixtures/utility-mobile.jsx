import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthContext } from "../src/AuthContext";
import BugReportPage from "../src/BugReportPage";
import AccountSettingsPage from "../src/AccountSettingsPage";
import AdminPortal from "../src/AdminPortal";
import TermsPage from "../src/legal/TermsPage";
import PrivacyPage from "../src/legal/PrivacyPage";
import SmsAlertsPage from "../src/legal/SmsAlertsPage";
import MobileShell from "../src/layout/MobileShell";
import MobileHeader from "../src/layout/MobileHeader";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/projections-experience.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/standalone-dialogs.css";
import "../src/styles/color-theme.css";

const params = new URLSearchParams(location.search);
const kind = params.get("page") || "report";
const user = { id: "sample", user_sub: "sample", name: "Maya Chen", email: "maya.long.account.address@sample.test", auth_type: "native", email_verified_at: "2026-09-01", has_password: true, memberships: [] };
// All fixture requests stay local. No account/admin/report writes reach the API.
window.fetch = async (url, options = {}) => {
  if (options.method && options.method !== "GET") return Response.json({ detail: "Preview only" }, { status: 403 });
  const path = String(url);
  if (path.includes("support/bugs/status")) return Response.json({ enabled: true });
  if (path.includes("admin/overview")) return Response.json({ native_user_count: 128, live_league_count: 12, test_league_count: 3, bot_sub_count: 24 });
  if (path.includes("admin/users")) return Response.json({ accounts: [user], system_subs: [] });
  if (path.includes("admin/leagues/")) return Response.json({ teams: [{ id: "open", name: "Sunday Roster" }], invites: [] });
  if (path.includes("admin/leagues")) return Response.json({ count: 1, leagues: [{ id: "fixture", name: "A Very Long Fantasy Football League Name", room_code: "SAMPLE", season: 2026, member_count: 10, team_rows: 12, commissioner_email: user.email }] });
  return Response.json({});
};
function Preview() {
  const [tab, setTab] = useState("overview");
  const pages = { report: <BugReportPage />, account: <AccountSettingsPage />, terms: <TermsPage />, privacy: <PrivacyPage />, sms: <SmsAlertsPage /> };
  return <AuthContext.Provider value={{ ready: true, authenticated: !params.has("guest"), user, refreshAuth: async () => {} }}>
    {kind === "admin" ? <MobileShell><header className="app-header"><MobileHeader title="Admin" /></header><main><AdminPortal adminTab={tab} onAdminTabChange={setTab} /></main></MobileShell> : pages[kind]}
  </AuthContext.Provider>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={["/report?from=/hub/available"]}><Preview /></MemoryRouter>);
