import React from "react";
import { Link } from "react-router-dom";
import { PRODUCT_DISCLAIMER } from "./auth";

function isSameOrigin(url) {
  if (!url || url.startsWith("/")) return true;
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function LegalAnchor({ href, children }) {
  if (href.startsWith("/")) {
    return (
      <Link to={href}>
        {children}
      </Link>
    );
  }
  const sameOrigin = isSameOrigin(href);
  return (
    <a href={href} target={sameOrigin ? undefined : "_blank"} rel={sameOrigin ? undefined : "noopener noreferrer"}>
      {children}
    </a>
  );
}

export default function LegalLinks({
  termsUrl,
  privacyUrl,
  showDisclaimer = true,
  className = "",
  compact = false,
}) {
  const terms = termsUrl || "/terms";
  const privacy = privacyUrl || "/privacy";

  return (
    <footer className={`legal-links${className ? ` ${className}` : ""}${compact ? " legal-links-compact" : ""}`}>
      <nav className="legal-links-nav" aria-label="Legal">
        <LegalAnchor href={terms}>Terms</LegalAnchor>
        <span className="legal-links-sep" aria-hidden="true">
          ·
        </span>
        <LegalAnchor href={privacy}>Privacy</LegalAnchor>
      </nav>
      {showDisclaimer && !compact && (
        <p className="legal-links-disclaimer chart-note">{PRODUCT_DISCLAIMER}</p>
      )}
    </footer>
  );
}

export function TermsCheckbox({ checked, onChange, termsUrl, privacyUrl, id = "accept-terms" }) {
  const terms = termsUrl || "/terms";
  const privacy = privacyUrl || "/privacy";
  return (
    <label className="legal-terms-checkbox hub-toggle-row">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
      />
      <span>
        I agree to the <LegalAnchor href={terms}>Terms of Service</LegalAnchor> and{" "}
        <LegalAnchor href={privacy}>Privacy Policy</LegalAnchor>
      </span>
    </label>
  );
}
