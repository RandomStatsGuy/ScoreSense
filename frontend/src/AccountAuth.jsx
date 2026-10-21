import React, { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import {
  forgotPassword,
  loginAccount,
  loginWithGoogle,
  loginWithPatreon,
  notifyAuthChanged,
  registerAccount,
  setToken,
} from "./auth";
import { useAuth } from "./AuthContext";
import { AUTH_COPY, authModeHref, authOauthNext, rememberLandingAuthIntent } from "./authPresentation";
import LegalLinks, { LegalAnchor, TermsCheckbox } from "./LegalLinks";

function GoogleMark() {
  return (
    <svg className="account-auth-google-mark" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.59.1-1.17.26-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.46.35 2.83.96 4.04l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96L3.97 7.3C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function SocialOptions({ oauthNext, onError, showGoogle, showPatreon, companion = false, termsUrl, privacyUrl }) {
  const startGoogle = () => {
    loginWithGoogle(oauthNext).catch((e) => onError?.(e.message || AUTH_COPY.googleUnavailable));
  };
  const startPatreon = () => {
    loginWithPatreon(oauthNext).catch((e) => onError?.(e.message));
  };
  if (!showGoogle && !showPatreon) return null;

  return (
    <div className="account-auth-social">
      {showGoogle ? (
        <button type="button" className="account-auth-google" onClick={startGoogle}>
          <GoogleMark />
          <span>{AUTH_COPY.google}</span>
        </button>
      ) : null}
      {showPatreon ? (
        <>
          <button type="button" className="btn-ghost account-auth-patreon" onClick={startPatreon}>
            {AUTH_COPY.patreon}
          </button>
          <p className="chart-note account-auth-patreon-note">{AUTH_COPY.patreonNote}</p>
        </>
      ) : null}
      {companion ? (
        <p className="account-auth-social-consent">
          {AUTH_COPY.companion.socialConsent}{" "}<LegalAnchor href={termsUrl || "/terms"}>{AUTH_COPY.companion.terms}</LegalAnchor>{" "}
          {AUTH_COPY.companion.and}{" "}<LegalAnchor href={privacyUrl || "/privacy"}>{AUTH_COPY.companion.privacy}</LegalAnchor>.
        </p>
      ) : <p className="chart-note account-auth-social-terms">{AUTH_COPY.socialTerms}</p>}
    </div>
  );
}

function ModeSwitch({ mode, compact, nextPath, onMode, sessionContext }) {
  const copy = mode === "register" ? AUTH_COPY.register : AUTH_COPY.login;
  const other = mode === "login" ? "register" : "login";
  if (compact) {
    return (
      <p className="account-auth-switch">
        {copy.switchPrompt}{" "}
        <button type="button" className="btn-link" onClick={() => onMode(other)}>
          {copy.switchAction}
        </button>
      </p>
    );
  }
  const href = authModeHref(other, nextPath, sessionContext);
  return (
    <p className="account-auth-switch">
      {copy.switchPrompt}{" "}
      <Link to={href}>{copy.switchAction}</Link>
    </p>
  );
}

export default function AccountAuth({
  onAuthed,
  title,
  subtitle,
  defaultEmail = "",
  compact = false,
  layout,
  mode: initialMode = "login",
  termsUrl,
  privacyUrl,
  onForgotPassword,
  patreonConfigured: patreonProp,
  googleConfigured: googleProp,
  patreonNext,
  nextPath,
  sessionContext,
}) {
  const auth = useAuth();
  const companion = layout === "companion";
  const session = companion || layout === "session" || (!compact && !title);
  const patreonConfigured = patreonProp ?? auth.patreonConfigured;
  const googleConfigured = googleProp ?? auth.googleConfigured;
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailExpanded, setEmailExpanded] = useState(!googleConfigured);
  const passwordId = useId();

  useEffect(() => {
    if (companion) setEmailExpanded(!googleConfigured);
  }, [companion, googleConfigured]);

  useEffect(() => {
    if (defaultEmail) setEmail(defaultEmail);
  }, [defaultEmail]);

  useEffect(() => {
    setMode(initialMode);
    setError("");
    setInfo("");
    setShowPassword(false);
  }, [initialMode]);

  const oauthNext = authOauthNext(
    patreonNext || nextPath,
    typeof window !== "undefined" ? window.location.search : "",
  );
  const copy = mode === "register" ? AUTH_COPY.register : AUTH_COPY.login;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      if (mode === "forgot") {
        await forgotPassword({ email });
        setInfo(AUTH_COPY.forgot.sent);
        return;
      }
      const data =
        mode === "register"
          ? await registerAccount({ email, password, displayName, acceptTerms })
          : await loginAccount({ email, password });
      if (data.token) setToken(data.token);
      if (mode === "register" && companion && sessionContext?.fromLanding) {
        rememberLandingAuthIntent(sessionContext.intent);
      }
      notifyAuthChanged();
      onAuthed?.(data.user);
    } catch (err) {
      setError(err.message || AUTH_COPY.defaultError);
    } finally {
      setBusy(false);
    }
  };

  const className = [
    "account-auth",
    compact ? "account-auth-compact" : "",
    session ? "account-auth-session" : "panel auth-panel",
    companion ? "account-auth-companion" : "",
  ].filter(Boolean).join(" ");

  if (mode === "forgot") {
    return (
      <section className={className}>
        {!session ? (
          <>
            <h2>{title || AUTH_COPY.forgot.heading}</h2>
            <p className="chart-note">{AUTH_COPY.forgot.support}</p>
          </>
        ) : null}
        <form className="account-auth-form" onSubmit={submit}>
          <label>
            <span className="hub-field-label">{AUTH_COPY.email}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <button type="submit" className="btn-primary account-auth-submit" disabled={busy}>
            {busy ? AUTH_COPY.forgot.submitBusy : AUTH_COPY.forgot.submit}
          </button>
        </form>
        {info && <p className="chart-note">{info}</p>}
        {error && <div className="error">{error}</div>}
        <button
          type="button"
          className="btn-ghost account-auth-back"
          onClick={() => (onForgotPassword ? onForgotPassword("login") : setMode("login"))}
        >
          {AUTH_COPY.forgot.back}
        </button>
      </section>
    );
  }

  const emailForm = (
      <form className="account-auth-form" onSubmit={submit} aria-busy={busy}>
        {mode === "register" && (
          <label>
            <span className="hub-field-label">{AUTH_COPY.displayName}{companion ? <small>{AUTH_COPY.companion.optional}</small> : null}</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={AUTH_COPY.displayName}
              autoComplete="name"
            />
          </label>
        )}
        <label>
          <span className="hub-field-label">{AUTH_COPY.email}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>
        {companion ? <div className="account-auth-password-field">
          <label htmlFor={passwordId}><span className="hub-field-label">{AUTH_COPY.password}</span></label>
          <div className={companion ? "account-auth-password-wrap" : undefined}>
          <input
            id={passwordId}
            type={companion && showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? AUTH_COPY.passwordHint : AUTH_COPY.passwordCurrent}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
            minLength={mode === "register" ? 8 : 1}
            aria-describedby={companion && mode === "register" ? `${passwordId}-hint` : undefined}
          />
          {companion ? <button type="button" className="account-auth-show-password" aria-label={showPassword ? AUTH_COPY.companion.hidePassword : AUTH_COPY.companion.showPassword} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? AUTH_COPY.companion.hide : AUTH_COPY.companion.show}</button> : null}
          </div>
          {companion && mode === "register" ? <p id={`${passwordId}-hint`} className="account-auth-password-hint">{AUTH_COPY.companion.passwordHint}</p> : null}
        </div> : <label>
          <span className="hub-field-label">{AUTH_COPY.password}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? AUTH_COPY.passwordHint : AUTH_COPY.passwordCurrent}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            required
            minLength={mode === "register" ? 8 : 1}
          />
        </label>}
        {mode === "register" && (
          <TermsCheckbox
            checked={acceptTerms}
            onChange={setAcceptTerms}
            termsUrl={termsUrl || auth.termsUrl}
            privacyUrl={privacyUrl || auth.privacyUrl}
          />
        )}
        <button
          type="submit"
          className="btn-primary account-auth-submit"
          disabled={busy || (mode === "register" && !acceptTerms)}
        >
          {busy ? copy.submitBusy : copy.submit}
        </button>
      </form>
  );

  const recoveryLink = mode === "login" && (
        session ? (
          <Link
            className="account-auth-forgot"
            to={`/auth/forgot-password?next=${encodeURIComponent(oauthNext)}`}
          >
            {AUTH_COPY.forgotLink}
          </Link>
        ) : (
          <button
            type="button"
            className="btn-link account-auth-forgot"
            onClick={() => (onForgotPassword ? onForgotPassword("forgot") : setMode("forgot"))}
          >
            {AUTH_COPY.forgotLink}
          </button>
        )
      );

  return (
    <section className={className}>
      {!session ? (
        <>
          <h2>{title || copy.heading}</h2>
          {!compact && (
            <p className="chart-note">{subtitle || copy.support}</p>
          )}
        </>
      ) : null}

      <SocialOptions
        oauthNext={oauthNext}
        onError={setError}
        showGoogle={Boolean(googleConfigured)}
        showPatreon={!companion && Boolean(patreonConfigured)}
        companion={companion}
        termsUrl={termsUrl || auth.termsUrl}
        privacyUrl={privacyUrl || auth.privacyUrl}
      />

      {companion ? (
        <details className="account-auth-email-option" open={emailExpanded} onToggle={(event) => setEmailExpanded(event.currentTarget.open)}>
          <summary><span className="account-auth-email-summary"><span>{AUTH_COPY.companion.email}</span><span className="account-auth-email-caret" aria-hidden="true">＋</span></span></summary>
          {emailForm}
          {recoveryLink}
        </details>
      ) : (
        <>
          {googleConfigured || patreonConfigured ? <div className="account-auth-divider"><span>{AUTH_COPY.emailDivider}</span></div> : null}
          {emailForm}
          {recoveryLink}
        </>
      )}

      {companion && patreonConfigured ? <p className="account-auth-patron-option">{AUTH_COPY.companion.patronPrompt}{" "}<button type="button" onClick={() => loginWithPatreon(oauthNext).catch((err) => setError(err.message || AUTH_COPY.defaultError))}>{AUTH_COPY.patreon} <span aria-hidden="true">↗</span></button></p> : null}

      {error && <div className="error" role="alert">{error}</div>}
      {mode === "register" && info && <p className="chart-note">{info}</p>}

      <ModeSwitch
        mode={mode}
        compact={compact}
        nextPath={oauthNext}
        onMode={setMode}
        sessionContext={sessionContext}
      />

      {!session && !compact && mode === "register" && (
        <LegalLinks
          termsUrl={termsUrl || auth.termsUrl}
          privacyUrl={privacyUrl || auth.privacyUrl}
          compact
          showDisclaimer={false}
        />
      )}
    </section>
  );
}
import "./styles/auth-session.css";
