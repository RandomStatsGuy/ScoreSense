import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
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

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projections/weekly" replace />} />
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
      <Route path="/hub/insights/:insightTab" element={<App />} />
      <Route path="/hub/insights" element={<Navigate to="/hub/insights/spend" replace />} />
      <Route path="/hub/:tab" element={<App />} />
      <Route path="/hub" element={<Navigate to="/hub/setup" replace />} />
      <Route path="/tools/:tab" element={<App />} />
      <Route path="/tools" element={<Navigate to="/tools/dfs" replace />} />
      <Route path="/model" element={<App />} />
      <Route path="/admin" element={<App />} />
      <Route path="*" element={<Navigate to="/projections/weekly" replace />} />
    </Routes>
  );
}
