import React, { useEffect, useState } from "react";
import {
  forgotPassword,
  loginAccount,
  loginWithPatreon,
  notifyAuthChanged,
  registerAccount,
  setToken,
} from "./auth";
import LegalLinks, { TermsCheckbox } from "./LegalLinks";

/** Patreon sign-in row — shared across every auth surface so email + Patreon
 *  are always presented together (gate, modal, hub, invite, mobile menu). */
function PatreonOption({ patreonNext, onError }) {
  return (
    <div className="account-auth-alt">
      <div className="account-auth-divider"><span>or</span></div>
      <button
        type="button"
        className="btn-ghost account-auth-patreon"
        onClick={() =>
          loginWithPatreon(
            patreonNext || `${window.location.pathname}${window.location.search}`,
          ).catch((e) => onError?.(e.message))
        }
      >
        Continue with Patreon
      </button>
      <p className="chart-note account-auth-patreon-note">For active patrons.</p>
    </div>
  );
}

export default function AccountAuth({
  onAuthed,
  title,
  subtitle,
  defaultEmail = "",
  compact = false,
  mode: initialMode = "login",
  termsUrl,
  privacyUrl,
  onForgotPassword,
  patreonConfigured = false,
  patreonNext,
}) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (defaultEmail) setEmail(defaultEmail);
  }, [defaultEmail]);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      if (mode === "forgot") {
        await forgotPassword({ email });
        setInfo("If an account exists, a reset link was sent to your email.");
        return;
      }
      const data =
        mode === "register"
          ? await registerAccount({ email, password, displayName, acceptTerms })
          : await loginAccount({ email, password });
      if (data.token) setToken(data.token);
      notifyAuthChanged();
      onAuthed?.(data.user);
    } catch (err) {
      setError(err.message || "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  if (mode === "forgot") {
    return (
      <section className={`panel auth-panel account-auth${compact ? " account-auth-compact" : ""}`}>
        {title ? <h2>{title}</h2> : <h2>Reset password</h2>}
        <p className="chart-note">Enter your account email and we&apos;ll send a reset link.</p>
        <form className="account-auth-form" onSubmit={submit}>
          <label>
            <span className="hub-field-label">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
        {info && <p className="chart-note">{info}</p>}
        {error && <div className="error">{error}</div>}
        <button
          type="button"
          className="btn-ghost btn-sm account-auth-back"
          onClick={() => (onForgotPassword ? onForgotPassword("login") : setMode("login"))}
        >
          Back to sign in
        </button>
      </section>
    );
  }

  return (
    <section className={`panel auth-panel account-auth${compact ? " account-auth-compact" : ""}`}>
      <h2>{title || "ScoreSense account"}</h2>
      {!compact && (
        <p className="chart-note">
          {subtitle || "Save league, Sleeper link, and contracts to your account."}
        </p>
      )}
      <div className="auth-mode-toggle">
        <button
          type="button"
          className={`btn-ghost btn-sm${mode === "login" ? " active" : ""}`}
          onClick={() => setMode("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`btn-ghost btn-sm${mode === "register" ? " active" : ""}`}
          onClick={() => setMode("register")}
        >
          Create account
        </button>
      </div>
      <form className="account-auth-form" onSubmit={submit}>
        {mode === "register" && (
          <label>
            <span className="hub-field-label">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              autoComplete="name"
            />
          </label>
        )}
        <label>
          <span className="hub-field-label">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>
        <label>
          <span className="hub-field-label">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
            minLength={mode === "register" ? 8 : 1}
          />
        </label>
        {mode === "register" && (
          <TermsCheckbox
            checked={acceptTerms}
            onChange={setAcceptTerms}
            termsUrl={termsUrl}
            privacyUrl={privacyUrl}
          />
        )}
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || (mode === "register" && !acceptTerms)}
        >
          {busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
        </button>
      </form>
      {mode === "login" && (
        <button
          type="button"
          className="btn-ghost btn-sm account-auth-forgot"
          onClick={() => (onForgotPassword ? onForgotPassword("forgot") : setMode("forgot"))}
        >
          Forgot password?
        </button>
      )}
      {error && <div className="error">{error}</div>}
      {mode === "register" && info && <p className="chart-note">{info}</p>}
      {patreonConfigured && (
        <PatreonOption patreonNext={patreonNext} onError={setError} />
      )}
      {!compact && mode === "register" && (
        <LegalLinks termsUrl={termsUrl} privacyUrl={privacyUrl} compact showDisclaimer={false} />
      )}
    </section>
  );
}
