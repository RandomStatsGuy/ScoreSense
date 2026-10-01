import React from "react";
import { Link } from "react-router-dom";
import StandalonePageShell, { StandaloneFormContent, StandalonePageFooter } from "../layout/StandalonePageShell";
import { PRODUCT_NAME, STUDIO_NAME } from "../brand";
import { SMS_OPT_IN } from "./legalPresentation";
import SmsOptInCard from "./SmsOptInCard";

export default function SmsAlertsPage() {
  return (
    <StandalonePageShell title={SMS_OPT_IN.title}>
      <div className="standalone-content-shell legal-page">
        <article className="panel standalone-content legal-page-content">
          <StandaloneFormContent>
            <h1 className="auth-panel-title-desktop">{SMS_OPT_IN.title}</h1>
            <p className="chart-note">{SMS_OPT_IN.support}</p>
            <SmsOptInCard showIntro={false} />
            <StandalonePageFooter>
              <Link className="btn-ghost btn-sm" to="/account">
                Account
              </Link>
            </StandalonePageFooter>
          </StandaloneFormContent>
        </article>
        <p className="app-studio-credit">
          {PRODUCT_NAME} · {STUDIO_NAME}
        </p>
      </div>
    </StandalonePageShell>
  );
}
