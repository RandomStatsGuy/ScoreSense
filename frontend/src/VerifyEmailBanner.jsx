import React, { useState } from "react";
import { fetchMe, resendVerificationEmail } from "./auth";

export default function VerifyEmailBanner({ user, onVerified }) {
  const [busy, setBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  if (!user || user.auth_type !== "native" || user.email_verified !== false) {
    return null;
  }

  const resend = async () => {
    setBusy(true);
    setMsg("");
    setErr("");
    try {
      const data = await resendVerificationEmail();
      setMsg(data.sent ? "Verification email sent — check your inbox." : "Could not send email.");
    } catch (e) {
      setErr(e.message || "Could not resend");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshBusy(true);
    setMsg("");
    setErr("");
    try {
      if (onVerified) await onVerified();
      const me = await fetchMe();
      if (me.user?.email_verified === false) {
        setMsg("Still unverified — open the link in your email again or resend.");
      }
    } catch (e) {
      setErr(e.message || "Could not refresh status");
    } finally {
      setRefreshBusy(false);
    }
  };

  return (
    <div className="verify-email-banner panel" role="status">
      <p>
        Verify <strong>{user.email}</strong> to use Draft Hub. Check your inbox for the link.
      </p>
      <div className="hub-toolbar">
        <button type="button" className="btn-ghost btn-sm" disabled={busy || refreshBusy} onClick={resend}>
          {busy ? "Sending…" : "Resend email"}
        </button>
        {onVerified && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy || refreshBusy}
            onClick={refresh}
          >
            {refreshBusy ? "Checking…" : "I verified — refresh"}
          </button>
        )}
      </div>
      {msg && <p className="chart-note">{msg}</p>}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
