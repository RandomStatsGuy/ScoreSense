import React, { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import App from "./App";
const SharedTeamRoom = lazy(() => import("./DraftHub/SharedTeamRoom"));
import { HubLoadingSkeleton } from "./DraftHub/HubUILayout";
const AccountSettingsPage = lazy(() => import("./AccountSettingsPage"));
const BugReportPage = lazy(() => import("./BugReportPage"));
const AuthCallbackPage = lazy(() => import("./AuthPages").then(m => ({ default: m.AuthCallbackPage })));
const AuthForgotPasswordPage = lazy(() => import("./AuthPages").then(m => ({ default: m.AuthForgotPasswordPage })));
const AuthResetPasswordPage = lazy(() => import("./AuthPages").then(m => ({ default: m.AuthResetPasswordPage })));
const AuthVerifyPage = lazy(() => import("./AuthPages").then(m => ({ default: m.AuthVerifyPage })));
const AuthSessionPage = lazy(() => import("./AuthSessionPage"));
const PrivacyPage = lazy(() => import("./legal/PrivacyPage"));
const SmsAlertsPage = lazy(() => import("./legal/SmsAlertsPage"));
const TermsPage = lazy(() => import("./legal/TermsPage"));
import { joinLandingPath, joinLandingSearch, withLocationSearch } from "./redirectSearch";
import { HUB_SLUG_TO_ID } from "./routes";

const LobbyJoinPage = lazy(() => import("./DraftHub/LobbyJoinPage"));

function RedirectKeepSearch({ to }) {
  const location = useLocation();
  return <Navigate to={withLocationSearch(to, location.search, location.hash)} replace />;
}

function HubTabOrHome() {
  const location = useLocation();
  const tab = location.pathname.split("/").filter(Boolean)[1];
  if (tab && tab !== "home" && !(tab in HUB_SLUG_TO_ID)) {
    return <Navigate to={withLocationSearch("/hub/home", location.search, location.hash)} replace />;
  }
  return <App />;
}

function RootRedirect() {
  const location = useLocation();
  const dest = joinLandingPath(location.search);
  const search = dest === "/hub/draft" ? joinLandingSearch(location.search) : location.search;
  return (
    <Navigate
      to={withLocationSearch(dest, search, location.hash)}
      replace
    />
  );
}

export default function AppRouter() {
  return (
    <Suspense fallback={<div className="app"><HubLoadingSkeleton rows={4} /></div>}>
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/team-room/:token" element={<Suspense fallback={<p className="chart-note">Opening the team room…</p>}><SharedTeamRoom /></Suspense>} />
      <Route path="/login" element={<AuthSessionPage mode="login" />} />
      <Route path="/register" element={<AuthSessionPage mode="register" />} />
      <Route path="/signup" element={<RedirectKeepSearch to="/register" />} />
      <Route
        path="/lobby/:roomCode"
        element={(
          <Suspense fallback={<p className="chart-note">Opening the lobby…</p>}>
            <LobbyJoinPage />
          </Suspense>
        )}
      />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/verify" element={<AuthVerifyPage />} />
      <Route path="/auth/reset-password" element={<AuthResetPasswordPage />} />
      <Route path="/auth/forgot-password" element={<AuthForgotPasswordPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/sms-alerts" element={<SmsAlertsPage />} />
      <Route path="/account" element={<AccountSettingsPage />} />
      <Route path="/report" element={<BugReportPage />} />
      <Route path="/projections/weekly" element={<App />} />
      <Route path="/projections/weekly/:panel" element={<App />} />
      <Route path="/projections/season" element={<App />} />
      <Route path="/projections/season/:mode" element={<App />} />
      <Route path="/projections/season/:mode/:panel" element={<App />} />
      <Route path="/hub/insights/trades" element={<Navigate to="/hub/trades" replace />} />
      <Route path="/hub/insights/desk" element={<Navigate to="/hub/roster-management/contracts" replace />} />
      <Route path="/hub/insights/salaries" element={<Navigate to="/hub/roster-management/sheets" replace />} />
      <Route path="/hub/insights/contracts" element={<Navigate to="/hub/roster-management/sheets" replace />} />
      <Route path="/hub/live" element={<Navigate to="/hub/game" replace />} />
      <Route path="/hub/my-team" element={<Navigate to="/hub/roster" replace />} />
      <Route path="/hub/game-center" element={<Navigate to="/hub/game" replace />} />
      <Route path="/hub/teams" element={<Navigate to="/hub/roster-management/contracts" replace />} />
      <Route path="/hub/players" element={<Navigate to="/hub/strategy" replace />} />
      <Route path="/hub/available" element={<Navigate to="/hub/free-agents" replace />} />
      <Route path="/hub/fa" element={<Navigate to="/hub/free-agents" replace />} />
      <Route path="/hub/office/:officeTab" element={<App />} />
      <Route path="/hub/office" element={<Navigate to="/hub/roster-management/contracts" replace />} />
      <Route path="/hub/roster-management/:officeTab" element={<App />} />
      <Route path="/hub/roster-management" element={<Navigate to="/hub/roster-management/contracts" replace />} />
      <Route path="/hub/insights/:insightTab" element={<App />} />
      <Route path="/hub/insights" element={<Navigate to="/hub/insights/overview" replace />} />
      <Route path="/hub/:tab" element={<HubTabOrHome />} />
      <Route path="/hub" element={<Navigate to="/hub/home" replace />} />
      <Route path="/tools/:tab" element={<App />} />
      <Route path="/tools" element={<Navigate to="/tools/dfs" replace />} />
      <Route path="/model" element={<App />} />
      <Route path="/admin/:adminTab?" element={<App />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
    </Suspense>
  );
}
