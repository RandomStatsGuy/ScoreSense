import React, { useState } from "react";
import { Link } from "react-router-dom";
import { SMS_OPT_IN } from "./legalPresentation";

function hasMobileNumber(value) {
  return String(value || "").replace(/\D/g, "").length >= 10;
}

export default function SmsOptInCard({ termsUrl = "/terms", privacyUrl = "/privacy" }) {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const onSubmit = (event) => {
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
    setSaved(true);
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
        <Link to={termsUrl}>{SMS_OPT_IN.termsLabel}</Link>
        {" · "}
        <Link to={privacyUrl}>{SMS_OPT_IN.privacyLabel}</Link>
      </p>
      <button type="submit" className="btn-primary btn-sm">
        {SMS_OPT_IN.submit}
      </button>
      {error && <div className="error">{error}</div>}
      {saved && <p className="chart-note">{SMS_OPT_IN.saved}</p>}
    </form>
  );
}
