import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { notifyAuthChanged, resetPassword, setToken } from "./auth";
import AccountAuth from "./AccountAuth";
import { AuthSessionChrome } from "./AuthSessionPage";
import { AUTH_COPY, safeAuthNext } from "./authPresentation";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      notifyAuthChanged();
    }
    const next = safeAuthNext(params.get("next"));
    navigate(next, { replace: true });
  }, [navigate, params]);

  return <div className="panel muted">Signing you in…</div>;
}

export function AuthVerifyPage() {
  const [params] = useSearchParams();
  const success = params.get("success") === "1";
  const error = params.get("error");
  const token = params.get("token");
  const confirming = token && !success && !error;

  useEffect(() => {
    if (confirming) {
      window.location.replace(
        `/api/auth/verify-email?token=${encodeURIComponent(token)}`,
      );
    }
  }, [confirming, token]);

  useEffect(() => {
    if (success) {
      notifyAuthChanged();
    }
  }, [success]);

  if (confirming) {
    return (
      <AuthSessionChrome
        eyebrow={AUTH_COPY.verify.eyebrow}
        heading={AUTH_COPY.verify.heading}
        support={AUTH_COPY.verify.confirming}
      >
        <p className="chart-note">{AUTH_COPY.verify.confirming}</p>
      </AuthSessionChrome>
    );
  }

  return (
    <AuthSessionChrome
      eyebrow={AUTH_COPY.verify.eyebrow}
      heading={success ? AUTH_COPY.verify.heading : AUTH_COPY.verify.heading}
      support={success ? AUTH_COPY.verify.success : error ? AUTH_COPY.verify.error : AUTH_COPY.verify.waiting}
    >
      {error ? <p className="error">{AUTH_COPY.verify.error}</p> : null}
      <p className="hub-toolbar">
        <Link className="btn-primary account-auth-submit" to="/hub/home">
          {AUTH_COPY.verify.openFantasy}
        </Link>
        <Link className="btn-ghost account-auth-patreon" to="/projections/weekly">
          {AUTH_COPY.verify.browse}
        </Link>
      </p>
    </AuthSessionChrome>
  );
}

export function AuthResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const next = safeAuthNext(params.get("next"), "/login");
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
      <AuthSessionChrome
        eyebrow={AUTH_COPY.reset.eyebrow}
        heading={AUTH_COPY.reset.heading}
        support={AUTH_COPY.reset.missing}
        backTo="/login"
      >
        <p className="error">{AUTH_COPY.reset.missing}</p>
        <Link className="btn-primary account-auth-submit" to="/login">
          {AUTH_COPY.login.submit}
        </Link>
      </AuthSessionChrome>
    );
  }

  return (
    <AuthSessionChrome
      eyebrow={AUTH_COPY.reset.eyebrow}
      heading={done ? AUTH_COPY.login.heading : AUTH_COPY.reset.heading}
      support={done ? AUTH_COPY.reset.done : AUTH_COPY.reset.support}
      backTo="/login"
    >
      {done ? (
        <Link className="btn-primary account-auth-submit" to={next.startsWith("/login") ? next : "/login"}>
          {AUTH_COPY.login.submit}
        </Link>
      ) : (
        <form className="account-auth-form" onSubmit={submit}>
          <label>
            <span className="hub-field-label">{AUTH_COPY.newPassword}</span>
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
            <span className="hub-field-label">{AUTH_COPY.confirmPassword}</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
          <button type="submit" className="btn-primary account-auth-submit" disabled={busy}>
            {busy ? AUTH_COPY.reset.submitBusy : AUTH_COPY.reset.submit}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      )}
    </AuthSessionChrome>
  );
}

export function AuthForgotPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeAuthNext(params.get("next"), "/login");
  const loginHref = `/login?next=${encodeURIComponent(next)}`;
  return (
    <AuthSessionChrome
      eyebrow={AUTH_COPY.forgot.eyebrow}
      heading={AUTH_COPY.forgot.heading}
      support={AUTH_COPY.forgot.support}
      backTo={loginHref}
    >
      <AccountAuth
        layout="session"
        mode="forgot"
        nextPath={next}
        onForgotPassword={() => navigate(loginHref)}
      />
    </AuthSessionChrome>
  );
}
