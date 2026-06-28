import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { notifyAuthChanged, resetPassword, setToken } from "./auth";
import AccountAuth from "./AccountAuth";
import LegalLinks from "./LegalLinks";
import { PRODUCT_NAME, STUDIO_NAME } from "./brand";

function AuthShell({ children, title }) {
  return (
    <div className="auth-shell auth-shell-page">
      <div className="panel auth-panel">
        <h2>{title}</h2>
        {children}
      </div>
      <LegalLinks className="auth-legal-footer" />
      <p className="app-studio-credit">
        {PRODUCT_NAME} · {STUDIO_NAME}
      </p>
    </div>
  );
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      notifyAuthChanged();
    }
    const next = params.get("next") || "/projections/weekly";
    const safeNext = next.startsWith("/") ? next : "/projections/weekly";
    navigate(safeNext, { replace: true });
  }, [navigate, params]);

  return <div className="panel muted">Signing you in…</div>;
}

export function AuthVerifyPage() {
  const [params] = useSearchParams();
  const success = params.get("success") === "1";
  const error = params.get("error");
  const token = params.get("token");

  useEffect(() => {
    if (token && !success && !error) {
      window.location.replace(
        `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
      );
    }
  }, [token, success, error]);

  if (token && !success && !error) {
    return (
      <AuthShell title="Email verification">
        <p className="chart-note">Confirming your email…</p>
      </AuthShell>
    );
  }

  useEffect(() => {
    if (success) {
      notifyAuthChanged();
    }
  }, [success]);

  return (
    <AuthShell title={success ? "Email verified" : "Email verification"}>
      {success && (
        <p className="chart-note">
          Your email is verified. You can use Draft Hub and all saved league features.
        </p>
      )}
      {error && <p className="error">This verification link is invalid or expired.</p>}
      {!success && !error && (
        <p className="chart-note">Check your inbox for a verification link.</p>
      )}
      <p className="hub-toolbar">
        <a className="btn-primary btn-sm" href="/hub/setup">
          Open Draft Hub
        </a>
        <a className="btn-ghost btn-sm" href="/projections/weekly">
          Browse projections
        </a>
      </p>
    </AuthShell>
  );
}

export function AuthResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setError(err.message || "Could not reset password");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Reset password">
        <p className="error">Missing reset token. Request a new link from the sign-in page.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={done ? "Password updated" : "Choose a new password"}>
      {done ? (
        <>
          <p className="chart-note">Your password was updated. Sign in to continue.</p>
          <a className="btn-primary" href="/projections/weekly">
            Sign in
          </a>
        </>
      ) : (
        <form className="account-auth-form" onSubmit={submit}>
          <label>
            <span className="hub-field-label">New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            <span className="hub-field-label">Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Update password"}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      )}
    </AuthShell>
  );
}

export function AuthForgotPasswordPage() {
  return (
    <AuthShell title="Reset password">
      <AccountAuth mode="forgot" title="" subtitle="" />
    </AuthShell>
  );
}
