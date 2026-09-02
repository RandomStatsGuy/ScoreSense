import React from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import App from "./App";
import AccountSettingsPage from "./AccountSettingsPage";
import {
  AuthCallbackPage,
  AuthForgotPasswordPage,
  AuthResetPasswordPage,
  AuthVerifyPage,
} from "./AuthPages";
import PrivacyPage from "./legal/PrivacyPage";
import TermsPage from "./legal/TermsPage";
import LobbyJoinPage from "./DraftHub/LobbyJoinPage";
import { withLocationSearch } from "./redirectSearch";

function RedirectKeepSearch({ to }) {
  const location = useLocation();
  return <Navigate to={withLocationSearch(to, location.search, location.hash)} replace />;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RedirectKeepSearch to="/projections/weekly" />} />
      <Route path="/lobby/:roomCode" element={<LobbyJoinPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/verify" element={<AuthVerifyPage />} />
      <Route path="/auth/reset-password" element={<AuthResetPasswordPage />} />
      <Route path="/auth/forgot-password" element={<AuthForgotPasswordPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/account" element={<AccountSettingsPage />} />
      <Route path="/projections/weekly" element={<App />} />
      <Route path="/projections/weekly/:panel" element={<App />} />
      <Route path="/projections/season/:mode" element={<App />} />
      <Route path="/hub/insights/trades" element={<Navigate to="/hub/trades" replace />} />
      <Route path="/hub/insights/desk" element={<Navigate to="/hub/office/current" replace />} />
      <Route path="/hub/insights/salaries" element={<Navigate to="/hub/office/historic" replace />} />
      <Route path="/hub/insights/contracts" element={<Navigate to="/hub/office/historic" replace />} />
      <Route path="/hub/live" element={<Navigate to="/hub/game" replace />} />
      <Route path="/hub/teams" element={<Navigate to="/hub/office/current" replace />} />
      <Route path="/hub/players" element={<Navigate to="/hub/strategy" replace />} />
      <Route path="/hub/available" element={<Navigate to="/hub/free-agents" replace />} />
      <Route path="/hub/fa" element={<Navigate to="/hub/free-agents" replace />} />
      <Route path="/hub/office/:officeTab" element={<App />} />
      <Route path="/hub/office" element={<Navigate to="/hub/office/current" replace />} />
      <Route path="/hub/insights/:insightTab" element={<App />} />
      <Route path="/hub/insights" element={<Navigate to="/hub/insights/overview" replace />} />
      <Route path="/hub/:tab" element={<App />} />
      <Route path="/hub" element={<Navigate to="/hub/home" replace />} />
      <Route path="/tools/:tab" element={<App />} />
      <Route path="/tools" element={<Navigate to="/tools/dfs" replace />} />
      <Route path="/model" element={<App />} />
      <Route path="/admin/:adminTab?" element={<App />} />
      <Route path="*" element={<RedirectKeepSearch to="/projections/weekly" />} />
    </Routes>
  );
}
