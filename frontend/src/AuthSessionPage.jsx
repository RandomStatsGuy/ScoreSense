import React, { useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import AccountAuth from "./AccountAuth";
import { useAuth } from "./AuthContext";
import LegalLinks from "./LegalLinks";
import { AUTH_COPY, safeAuthNext } from "./authPresentation";
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
      <div className="auth-session-inner">
        <Link className="auth-session-back" to={backTo}>
          ← {backLabel}
        </Link>
        <p className="auth-session-brand">{PRODUCT_NAME}</p>
        <p className="auth-session-studio">{STUDIO_NAME}</p>
        <header className="auth-session-hero">
          {eyebrow ? <p className="auth-session-eyebrow">{eyebrow}</p> : null}
          {heading ? <h1 className="auth-session-heading">{heading}</h1> : null}
          {support ? <p className="auth-session-support">{support}</p> : null}
        </header>
        <div className="auth-session-card">{children}</div>
        <LegalLinks className="auth-session-legal" />
      </div>
    </div>
  );
}

export default function AuthSessionPage({ mode = "login" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { ready, authenticated } = useAuth();
  const next = safeAuthNext(params.get("next"));
  const copy = mode === "register" ? AUTH_COPY.register : AUTH_COPY.login;

  useEffect(() => {
    if (ready && authenticated) {
      navigate(next, { replace: true });
    }
  }, [ready, authenticated, navigate, next]);

  if (ready && authenticated) {
    return <Navigate to={next} replace />;
  }

  return (
    <AuthSessionChrome
      eyebrow={copy.eyebrow}
      heading={copy.heading}
      support={copy.support}
      backTo={next}
    >
      <AccountAuth
        layout="session"
        mode={mode}
        nextPath={next}
        onAuthed={() => navigate(next, { replace: true })}
      />
    </AuthSessionChrome>
  );
}
