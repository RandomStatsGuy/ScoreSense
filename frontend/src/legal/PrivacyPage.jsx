import React from "react";
import { Link } from "react-router-dom";
import StandalonePageShell from "../layout/StandalonePageShell";
import { PRODUCT_NAME, STUDIO_NAME } from "../brand";

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
      <p className="chart-note">Last updated: June 2026</p>
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
            <strong>Draft Hub:</strong> league settings, rosters, cap sheets, Sleeper links, and
            related league data you save in the app.
          </li>
          <li>
            <strong>Technical:</strong> standard server logs (IP, user agent, request timing) for
            security and debugging.
          </li>
        </ul>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">3. How we use it</h2>
        <p>
          To authenticate you, send account emails (verification, password reset, league invites),
          store your league workspace, and improve the product. We do not sell your personal
          information.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">4. Where data is stored</h2>
        <p>
          Account and league data are stored on our servers (SQLite databases on a VPS). Email is
          sent through our configured SMTP provider (e.g. Resend).
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">5. Third parties</h2>
        <p>
          Patreon (OAuth), Sleeper (when you link a league), and email delivery providers process
          data according to their policies when you use those features.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">6. Your choices</h2>
        <p>
          You may delete your email account from Account settings (login credentials are removed;
          Draft Hub league data may remain until manually cleaned up). Contact us to request
          information about data we hold.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">7. Contact</h2>
        <p>
          Privacy questions:{" "}
          <a href="mailto:fourthdownlabs@gmail.com">fourthdownlabs@gmail.com</a>
        </p>
      </section>
    </LegalShell>
  );
}
