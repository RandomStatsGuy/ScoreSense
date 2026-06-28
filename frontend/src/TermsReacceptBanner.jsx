import React, { useState } from "react";
import { acceptTerms } from "./auth";
import LegalLinks, { TermsCheckbox } from "./LegalLinks";

export default function TermsReacceptBanner({ user, termsUrl, privacyUrl, onAccepted }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!user || user.auth_type !== "native" || user.terms_current !== false) {
    return null;
  }

  const submit = async () => {
    if (!checked) {
      setErr("Accept the updated Terms and Privacy Policy to continue.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await acceptTerms();
      onAccepted?.();
    } catch (e) {
      setErr(e.message || "Could not save acceptance");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="verify-email-banner panel terms-reaccept-banner" role="status">
      <p>Our Terms of Service or Privacy Policy were updated. Please review and accept to continue.</p>
      <TermsCheckbox
        checked={checked}
        onChange={setChecked}
        termsUrl={termsUrl}
        privacyUrl={privacyUrl}
        id="reaccept-terms"
      />
      <div className="hub-toolbar">
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Accept and continue"}
        </button>
      </div>
      <LegalLinks termsUrl={termsUrl} privacyUrl={privacyUrl} compact showDisclaimer={false} />
      {err && <div className="error">{err}</div>}
    </div>
  );
}
