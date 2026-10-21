import "./styles/auth-session.css";
import "./styles/auth-session-landing.css";
import React, { useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import AccountAuth from "./AccountAuth";
import { useAuth } from "./AuthContext";
import LegalLinks from "./LegalLinks";
import { AUTH_COPY, authSessionContext } from "./authPresentation";
import { PRODUCT_NAME, STUDIO_NAME } from "./brand";

export function AuthSessionChrome({
  eyebrow,
  heading,
  support,
  backTo = "/projections/weekly",
  backLabel = AUTH_COPY.brandBack,
  children,
}) {
  return (
    <div className="auth-session">
      <a className="app-skip-link" href="#main-content">Skip to content</a>
      <main id="main-content" tabIndex={-1} className="auth-session-inner">
        <Link className="auth-session-back" to={backTo}>
          ← {backLabel}
        </Link>
        <p className="auth-session-brand">
          {PRODUCT_NAME}
          <span className="auth-session-studio"> · {STUDIO_NAME}</span>
        </p>
        <header className="auth-session-hero">
          {eyebrow ? <p className="auth-session-eyebrow">{eyebrow}</p> : null}
          {heading ? <h1 className="auth-session-heading">{heading}</h1> : null}
          {support ? <p className="auth-session-support">{support}</p> : null}
        </header>
        <div className="auth-session-card">{children}</div>
        <LegalLinks className="auth-session-legal" compact />
      </main>
    </div>
  );
}

export default function AuthSessionPage({ mode = "login" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { ready, authenticated } = useAuth();
  const context = authSessionContext(params.toString());
  const { next, destination } = context;
  const copy = AUTH_COPY.companion;
  const register = mode === "register";

  useEffect(() => {
    if (ready && authenticated) {
      navigate(next, { replace: true });
    }
  }, [ready, authenticated, navigate, next]);

  useEffect(() => {
    document.title = `${register ? AUTH_COPY.register.eyebrow : AUTH_COPY.login.eyebrow} · ${PRODUCT_NAME}`;
  }, [register]);

  if (ready && authenticated) {
    return <Navigate to={next} replace />;
  }

  return (
    <div className="auth-companion">
      <a className="app-skip-link" href="#main-content">Skip to content</a>
      <div className="auth-companion-canvas">
        <header className="auth-companion-header">
          <Link className="auth-companion-brand" to={context.backTo} aria-label={`${PRODUCT_NAME} · ${copy.back}`}>
            <span className="auth-companion-symbol" aria-hidden="true">S↗</span>
            <span>{PRODUCT_NAME}<small>{STUDIO_NAME}</small></span>
          </Link>
          <Link className="auth-companion-back" to={context.backTo}>
            <span aria-hidden="true">←</span> {copy.back}
          </Link>
        </header>
        <main id="main-content" tabIndex={-1} className="auth-companion-layout">
          <section className="auth-companion-story" aria-labelledby="auth-story-heading">
            <p className="auth-companion-eyebrow">{copy.storyEyebrow}</p>
            <h1 id="auth-story-heading">{copy.storyHeading}</h1>
            <p className="auth-companion-intro">{copy.storySupport}</p>
            <div className="auth-companion-scene">
              <div className="auth-companion-topline"><span>{destination.area}</span><span>{copy.illustration}</span></div>
              <div className="auth-companion-scene-title"><h2>{destination.title}</h2><span aria-hidden="true">↗</span></div>
              {context.intent === "weekly" ? (
                <div className="auth-companion-range">
                  <div className="auth-companion-range-labels"><span>{copy.floor}</span><strong>{copy.outlook}</strong><span>{copy.ceiling}</span></div>
                  <div className="auth-companion-range-track" aria-hidden="true"><span /><i /></div>
                  <div className="auth-companion-range-labels"><span>{copy.safer}</span><span>{copy.upside}</span></div>
                </div>
              ) : context.intent === "fantasy" ? (
                <div className="auth-companion-room">
                  <div className="auth-companion-jerseys" aria-hidden="true"><span>01</span><span>11</span><span>22</span></div>
                  <div><strong>{copy.fantasyRoom}</strong><p>{copy.fantasySupport}</p></div>
                </div>
              ) : (
                <div className="auth-companion-tools">{copy.tools.map((tool) => <span key={tool}>{tool}</span>)}</div>
              )}
              <p className="auth-companion-scene-note">{destination.note}</p>
            </div>
            <div className="auth-companion-values">
              {copy.values.map((value, index) => (
                <div key={value.area}><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><p><strong>{value.area}</strong><span>{value.support}</span></p></div>
              ))}
            </div>
          </section>
          <section className="auth-companion-panel" aria-labelledby="auth-panel-heading">
            <p className="auth-companion-context"><span aria-hidden="true">↗</span> {copy.next} {destination.name}</p>
            <header className="auth-companion-panel-heading">
              <p className="auth-companion-eyebrow">{register ? copy.registerEyebrow : copy.loginEyebrow}</p>
              <h2 id="auth-panel-heading">{register ? copy.registerHeading : copy.loginHeading}</h2>
              <p>{register ? copy.registerSupport : copy.loginSupport}</p>
            </header>
            <AccountAuth
              layout="companion"
              mode={mode}
              nextPath={next}
              sessionContext={context}
              onAuthed={() => navigate(next, { replace: true })}
            />
          </section>
        </main>
        <div className="auth-companion-footer"><span>{PRODUCT_NAME} · {STUDIO_NAME}</span><LegalLinks compact /></div>
      </div>
    </div>
  );
}
