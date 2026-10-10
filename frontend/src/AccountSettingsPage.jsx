import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AUTH_COPY } from "./authPresentation";
import LegalLinks from "./LegalLinks";
import VerifyEmailBanner from "./VerifyEmailBanner";
import StandalonePageShell, { StandaloneFormContent, StandalonePageFooter } from "./layout/StandalonePageShell";
import {
  changePassword,
  deleteAccount,
  logout,
  notifyAuthChanged,
  setToken,
  updateProfile,
} from "./auth";
import { PRODUCT_NAME, STUDIO_NAME } from "./brand";
import { parseApiError } from "./format";
import SmsOptInCard from "./legal/SmsOptInCard";
import { BUG_REPORT_COPY } from "./bugReportPresentation";
import AppearanceSettings from "./AppearanceSettings";

export default function AccountSettingsPage() {
  const { ready, authenticated, user, termsUrl, privacyUrl, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const isNative = user?.auth_type === "native";
  const hasPassword = user?.has_password !== false && isNative;
  const googleLinked = Boolean(user?.google_linked);

  const [displayName, setDisplayName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");

  const [deletePassword, setDeletePassword] = useState("");
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  React.useEffect(() => {
    if (user?.name) setDisplayName(user.name);
  }, [user?.name]);

  if (!ready) {
    return <div className="panel muted">Loading…</div>;
  }

  if (!authenticated) {
    return (
      <StandalonePageShell title="Account settings">
        <div className="auth-shell auth-shell-page">
          <div className="panel auth-panel">
            <h2 className="auth-panel-title-desktop">Account settings</h2>
            <p className="chart-note">Sign in to manage your account.</p>
            <Link className="btn-primary" to="/login?next=/account">
              Sign in
            </Link>
            <p className="chart-note">
              <Link to="/register?next=/account">Create account</Link>
            </p>
          </div>
        </div>
      </StandalonePageShell>
    );
  }

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!isNative) return;
    setProfileBusy(true);
    setProfileMsg("");
    setProfileErr("");
    try {
      await updateProfile({ displayName });
      setProfileMsg("Display name updated.");
      await refreshAuth();
      notifyAuthChanged();
    } catch (err) {
      setProfileErr(err.message || "Could not update profile");
    } finally {
      setProfileBusy(false);
    }
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPwErr("New passwords do not match");
      return;
    }
    setPwBusy(true);
    setPwMsg("");
    setPwErr("");
    try {
      const data = await changePassword({ currentPassword, newPassword });
      if (data.token) setToken(data.token);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwMsg("Password updated.");
      await refreshAuth();
      notifyAuthChanged();
    } catch (err) {
      setPwErr(err.message || "Could not change password");
    } finally {
      setPwBusy(false);
    }
  };

  const submitDelete = async (e) => {
    e.preventDefault();
    if (!deleteConfirm) {
      setDeleteErr("Confirm that you understand league data may remain");
      return;
    }
    setDeleteBusy(true);
    setDeleteErr("");
    try {
      await deleteAccount({
        password: hasPassword ? deletePassword : "",
        confirmEmail: hasPassword ? undefined : deleteEmail,
      });
      await logout();
      notifyAuthChanged();
      navigate("/projections/weekly", { replace: true });
    } catch (err) {
      setDeleteErr(err.message || "Could not delete account");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <StandalonePageShell title="Account settings">
      <div className="standalone-content-shell account-settings-page">
        <div className="panel standalone-content account-settings-panel">
          <StandaloneFormContent>
            <h2 className="auth-panel-title-desktop">Account settings</h2>
            <p className="chart-note">
              {isNative
                ? googleLinked
                  ? "Google account"
                  : "Email account"
                : "Patreon account"}{" "}
              · {user?.email || user?.name}
            </p>

            <VerifyEmailBanner user={user} onVerified={refreshAuth} />

            <section className="account-settings-section">
              <h3 className="hub-panel-subtitle">Profile</h3>
              {isNative ? (
                <form className="account-auth-form" onSubmit={saveProfile}>
                  <label>
                    <span className="hub-field-label">Email</span>
                    <input type="email" value={user?.email || ""} readOnly disabled />
                  </label>
                  <label>
                    <span className="hub-field-label">Display name</span>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                    />
                  </label>
                  <button type="submit" className="btn-primary btn-sm" disabled={profileBusy}>
                    {profileBusy ? "Saving…" : "Save name"}
                  </button>
                  {profileMsg && <p className="chart-note">{profileMsg}</p>}
                  {profileErr && <div className="error">{profileErr}</div>}
                </form>
              ) : (
                <p className="chart-note">
                  Name and email come from Patreon. Update them in your Patreon profile.
                </p>
              )}
            </section>

            <section className="account-settings-section">
              <SmsOptInCard termsUrl={termsUrl} privacyUrl={privacyUrl} embedded />
            </section>

            <AppearanceSettings />

            <section className="account-settings-section">
              <h3 className="hub-panel-subtitle">On-site notifications</h3>
              <Link className="btn-ghost" to="/hub/home?notifications=settings">Notification settings</Link>
            </section>

            <section className="account-settings-section">
              <h3 className="hub-panel-subtitle">Security</h3>
              {isNative && hasPassword ? (
                <form className="account-auth-form" onSubmit={submitPassword}>
                  <label>
                    <span className="hub-field-label">Current password</span>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </label>
                  <label>
                    <span className="hub-field-label">New password</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <label>
                    <span className="hub-field-label">Confirm new password</span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <button type="submit" className="btn-ghost btn-sm" disabled={pwBusy}>
                    {pwBusy ? "Updating…" : "Change password"}
                  </button>
                  {pwMsg && <p className="chart-note">{pwMsg}</p>}
                  {pwErr && <div className="error">{pwErr}</div>}
                </form>
              ) : isNative ? (
                <p className="chart-note">
                  {googleLinked
                    ? `${AUTH_COPY.googleLinked} ${AUTH_COPY.setPasswordHint}`
                    : AUTH_COPY.passwordDisabled}
                </p>
              ) : (
                <p className="chart-note">Password is managed by Patreon.</p>
              )}
              {isNative && (
                <p className="chart-note">
                  <Link to="/auth/forgot-password">Forgot password?</Link> — send a reset link to your email.
                </p>
              )}
            </section>

            <section className="account-settings-section">
              <h3 className="hub-panel-subtitle">{BUG_REPORT_COPY.eyebrow}</h3>
              <p className="chart-note">{BUG_REPORT_COPY.accountLink}</p>
              <p className="hub-toolbar">
                <Link className="btn-ghost btn-sm" to="/report?from=%2Faccount">
                  {BUG_REPORT_COPY.accountAction}
                </Link>
              </p>
            </section>

            {isNative && (
              <details className="account-settings-section account-settings-danger">
                <summary>
                  <span>
                    <strong>Delete account</strong>
                    <small>Permanently remove your login</small>
                  </span>
                </summary>
                <div className="account-settings-danger-body">
                  <p className="chart-note">
                    Removes your login credentials. League data and rosters linked to your account may
                    still exist until manually cleaned up.
                  </p>
                  <form className="account-auth-form" onSubmit={submitDelete}>
                    {hasPassword ? (
                      <label>
                        <span className="hub-field-label">Password</span>
                        <input
                          type="password"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          autoComplete="current-password"
                          required
                        />
                      </label>
                    ) : (
                      <label>
                        <span className="hub-field-label">Type your account email</span>
                        <input
                          type="email"
                          value={deleteEmail}
                          onChange={(e) => setDeleteEmail(e.target.value)}
                          autoComplete="email"
                          required
                        />
                      </label>
                    )}
                    <label className="legal-terms-checkbox hub-toggle-row">
                      <input
                        type="checkbox"
                        checked={deleteConfirm}
                        onChange={(e) => setDeleteConfirm(e.target.checked)}
                      />
                      <span>I understand my login will be removed and league data may remain.</span>
                    </label>
                    <button type="submit" className="btn-ghost btn-sm account-delete-btn" disabled={deleteBusy}>
                      {deleteBusy ? "Deleting…" : "Delete account"}
                    </button>
                    {deleteErr && <div className="error">{deleteErr}</div>}
                  </form>
                </div>
              </details>
            )}

            <StandalonePageFooter>
              <LegalLinks termsUrl={termsUrl} privacyUrl={privacyUrl} compact showDisclaimer={false} />
              <Link className="btn-ghost btn-sm" to="/projections/weekly">
                Back to {PRODUCT_NAME}
              </Link>
            </StandalonePageFooter>
          </StandaloneFormContent>
        </div>
        <p className="app-studio-credit">
          {PRODUCT_NAME} · {STUDIO_NAME}
        </p>
      </div>
    </StandalonePageShell>
  );
}
