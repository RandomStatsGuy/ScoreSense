import React from "react";
import { Link } from "react-router-dom";
import StandalonePageShell from "../layout/StandalonePageShell";
import { PRODUCT_NAME, STUDIO_NAME } from "../brand";
import { SMS_OPT_IN } from "./legalPresentation";
import SmsOptInCard from "./SmsOptInCard";

export default function SmsAlertsPage() {
  return (
    <StandalonePageShell title={SMS_OPT_IN.title}>
      <div className="auth-shell auth-shell-page legal-page">
        <article className="panel auth-panel legal-page-content">
          <h1 className="auth-panel-title-desktop">{SMS_OPT_IN.title}</h1>
          <p className="chart-note">{SMS_OPT_IN.support}</p>
          <SmsOptInCard />
          <p className="hub-toolbar legal-page-back auth-panel-back-desktop">
            <Link className="btn-ghost btn-sm" to="/account">
              Account
            </Link>
          </p>
        </article>
        <p className="app-studio-credit">
          {PRODUCT_NAME} · {STUDIO_NAME}
        </p>
      </div>
    </StandalonePageShell>
  );
}
