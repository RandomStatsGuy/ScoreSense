import React from "react";
import { Link } from "react-router-dom";
import StandalonePageShell from "../layout/StandalonePageShell";
import { PRODUCT_NAME, STUDIO_NAME } from "../brand";
import { LEGAL_PRIVACY } from "./legalPresentation";

function LegalShell({ title, children }) {
  return (
    <StandalonePageShell title={title}>
      <div className="auth-shell auth-shell-page legal-page">
        <article className="panel auth-panel legal-page-content">
          <h1 className="auth-panel-title-desktop">{title}</h1>
          {children}
          <p className="hub-toolbar legal-page-back auth-panel-back-desktop">
            <Link className="btn-ghost btn-sm" to="/projections/weekly">
              Back to app
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

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p className="chart-note">Last updated: {LEGAL_PRIVACY.lastUpdated}</p>
      <section>
        <h2 className="hub-panel-subtitle">1. Who we are</h2>
        <p>
          {PRODUCT_NAME} ({STUDIO_NAME}) provides fantasy football tools at app.fourthdownlabs.com.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">2. Information we collect</h2>
        <ul className="legal-page-list">
          <li>
            <strong>Account data:</strong> email, display name, password hash (email accounts), terms
            acceptance timestamp, email verification status.
          </li>
          <li>
            <strong>Patreon sign-in:</strong> Patreon user id, name, and email from OAuth (when you
            choose Patreon login).
          </li>
          <li>
            <strong>Google sign-in:</strong> Google user id, name, and email from OAuth (when you
            choose Continue with Google). We treat that email as verified.
          </li>
          <li>
            <strong>Mobile number:</strong> {LEGAL_PRIVACY.phoneCollect}
          </li>
          <li>
            <strong>Fantasy:</strong> league settings, rosters, cap sheets, Sleeper links, and
            related league data you save in the app.
          </li>
          <li>
            <strong>Technical:</strong> standard server logs (IP, user agent, request timing) for
            security and debugging.
          </li>
          <li>
            <strong>Bug reports:</strong> if you send a report from Account or the menu, we store
            the title, what happened, optional expected result, page path, and your account
            email/name on the SCORE board so we can fix it.
          </li>
        </ul>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">3. How we use it</h2>
        <p>
          To authenticate you, send account emails (verification, password reset, league invites),
          send draft alert texts you opted into, store your league workspace, file bug reports you
          send, and understand how the product is used so we can improve it. We do not sell your
          personal information.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">4. Where data is stored</h2>
        <p>
          Account and league data are stored on our servers (SQLite databases on a VPS). Email is
          sent through our configured SMTP provider (e.g. Resend). Bug reports you send are stored
          in Atlassian Jira.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">5. Third parties</h2>
        <p>
          Google (OAuth), Patreon (OAuth), Sleeper (when you link a league), Twilio (when you opt in
          to draft alert texts), Atlassian Jira (when you send a bug report), and email delivery
          providers process data according to their policies when you use those features.{" "}
          {LEGAL_PRIVACY.twilioThirdParty} {LEGAL_PRIVACY.jiraThirdParty} We use Google Analytics 4
          on app.fourthdownlabs.com to measure which pages are used. Google receives the page path,
          a human-readable page title, and truncated query filters (for example position or week).
          We do not send login tokens, invite codes, search text, or player-compare IDs to Google.
          IP anonymization is enabled. See{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google&apos;s privacy policy
          </a>
          .
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">6. {LEGAL_PRIVACY.smsTitle}</h2>
        <p>{LEGAL_PRIVACY.smsBody}</p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">7. Your choices</h2>
        <p>
          {LEGAL_PRIVACY.smsChoice} You may delete your email account from Account settings (login
          credentials are removed; Fantasy league data may remain until manually cleaned up).
          Contact us to request information about data we hold.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">8. Contact</h2>
        <p>
          Privacy questions:{" "}
          <a href="mailto:fourthdownlabs@gmail.com">fourthdownlabs@gmail.com</a>
        </p>
      </section>
    </LegalShell>
  );
}
