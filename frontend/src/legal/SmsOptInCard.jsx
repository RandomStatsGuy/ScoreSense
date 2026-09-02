import React, { useState } from "react";
import { useAuth } from "../AuthContext";
import { updateSmsOptIn } from "../auth";
import { LegalAnchor } from "../LegalLinks";
import { SMS_OPT_IN } from "./legalPresentation";

function hasMobileNumber(value) {
  return String(value || "").replace(/\D/g, "").length >= 10;
}

export default function SmsOptInCard({ termsUrl = "/terms", privacyUrl = "/privacy" }) {
  const { user, refreshAuth } = useAuth();
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const terms = termsUrl || "/terms";
  const privacy = privacyUrl || "/privacy";

  React.useEffect(() => {
    if (user?.phone) setPhone(user.phone);
    if (user?.sms_opted_in && user?.phone) setSaved(true);
  }, [user?.phone, user?.sms_opted_in]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaved(false);
    if (!hasMobileNumber(phone)) {
      setError(SMS_OPT_IN.needPhone);
      return;
    }
    if (!consent) {
      setError(SMS_OPT_IN.needConsent);
      return;
    }
    setError("");
    setBusy(true);
    try {
      await updateSmsOptIn({ phone, consent: true });
      if (refreshAuth) await refreshAuth();
      setSaved(true);
    } catch (err) {
      const message = String(err?.message || "");
      if (/login required|email accounts|sign in/i.test(message)) {
        setError(SMS_OPT_IN.needAccount);
      } else {
        setError(message || SMS_OPT_IN.saveFailed);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="account-auth-form sms-opt-in-card" onSubmit={onSubmit}>
      <h2 className="hub-panel-subtitle">{SMS_OPT_IN.title}</h2>
      <p className="chart-note">{SMS_OPT_IN.support}</p>
      <label>
        <span className="hub-field-label">{SMS_OPT_IN.phoneLabel}</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={SMS_OPT_IN.phonePlaceholder}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />
      </label>
      <label className="legal-terms-checkbox hub-toggle-row">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>{SMS_OPT_IN.consent}</span>
      </label>
      <p className="chart-note">{SMS_OPT_IN.frequency}</p>
      <p className="chart-note">{SMS_OPT_IN.rates}</p>
      <p className="chart-note">{SMS_OPT_IN.helpStop}</p>
      <p className="chart-note">
        <LegalAnchor href={terms}>{SMS_OPT_IN.termsLabel}</LegalAnchor>
        {" · "}
        <LegalAnchor href={privacy}>{SMS_OPT_IN.privacyLabel}</LegalAnchor>
      </p>
      <button type="submit" className="btn-primary btn-sm" disabled={busy}>
        {SMS_OPT_IN.submit}
      </button>
      {error && <div className="error">{error}</div>}
      {saved && <p className="chart-note">{SMS_OPT_IN.saved}</p>}
    </form>
  );
}
