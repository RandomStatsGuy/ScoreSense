import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import LegalLinks from "./LegalLinks";
import VerifyEmailBanner from "./VerifyEmailBanner";
import StandalonePageShell from "./layout/StandalonePageShell";
import {
  changePassword,
  deleteAccount,
  logout,
  notifyAuthChanged,
  setToken,
  updateProfile,
} from "./auth";
import { PRODUCT_NAME, STUDIO_NAME } from "./brand";

export default function AccountSettingsPage() {
  const { ready, authenticated, user, termsUrl, privacyUrl, refreshAuth, openSignIn } = useAuth();
  const navigate = useNavigate();
  const isNative = user?.auth_type === "native";

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
            <button type="button" className="btn-primary" onClick={openSignIn}>
              Sign in
            </button>
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
      await deleteAccount({ password: deletePassword });
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
      <div className="auth-shell auth-shell-page account-settings-page">
        <div className="panel auth-panel account-settings-panel">
          <h2 className="auth-panel-title-desktop">Account settings</h2>
        <p className="chart-note">
          {isNative ? "Email account" : "Patreon account"} · {user?.email || user?.name}
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
          <h3 className="hub-panel-subtitle">Security</h3>
          {isNative ? (
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
              <button type="submit" className="btn-primary btn-sm" disabled={pwBusy}>
                {pwBusy ? "Updating…" : "Change password"}
              </button>
              {pwMsg && <p className="chart-note">{pwMsg}</p>}
              {pwErr && <div className="error">{pwErr}</div>}
            </form>
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
          <h3 className="hub-panel-subtitle">Legal</h3>
          <LegalLinks termsUrl={termsUrl} privacyUrl={privacyUrl} compact showDisclaimer={false} />
        </section>

        {isNative && (
          <section className="account-settings-section account-settings-danger">
            <h3 className="hub-panel-subtitle">Delete account</h3>
            <p className="chart-note">
              Removes your login credentials. Draft Hub leagues and rosters linked to your account may
              still exist until manually cleaned up.
            </p>
            <form className="account-auth-form" onSubmit={submitDelete}>
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
          </section>
        )}

        <p className="hub-toolbar auth-panel-back-desktop">
          <Link className="btn-ghost btn-sm" to="/projections/weekly">
            Back to {PRODUCT_NAME}
          </Link>
        </p>
      </div>
      <p className="app-studio-credit">
        {PRODUCT_NAME} · {STUDIO_NAME}
      </p>
    </div>
    </StandalonePageShell>
  );
}
