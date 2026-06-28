import React from "react";
import { Link } from "react-router-dom";
import { PRODUCT_NAME, STUDIO_NAME } from "../brand";

function LegalShell({ title, children }) {
  return (
    <div className="auth-shell auth-shell-page legal-page">
      <article className="panel auth-panel legal-page-content">
        <h1>{title}</h1>
        {children}
        <p className="hub-toolbar legal-page-back">
          <Link className="btn-ghost btn-sm" to="/projections/weekly">
            Back to app
          </Link>
        </p>
      </article>
      <p className="app-studio-credit">
        {PRODUCT_NAME} · {STUDIO_NAME}
      </p>
    </div>
  );
}

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p className="chart-note">Last updated: June 2026</p>
      <section>
        <h2 className="hub-panel-subtitle">1. Service</h2>
        <p>
          {PRODUCT_NAME} is operated by {STUDIO_NAME}. The app provides fantasy football projections,
          draft tools, and related analytics for entertainment and research purposes only.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">2. Not gambling or financial advice</h2>
        <p>
          Projections, props scans, DFS tools, and similar features are not gambling advice, betting
          recommendations, or financial guidance. You are responsible for how you use the information.
          Must be 18+ where applicable.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">3. Accounts</h2>
        <p>
          You are responsible for keeping your login credentials secure. Email accounts require a
          verified address to use Draft Hub. Patreon subscribers sign in through Patreon OAuth.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">4. Acceptable use</h2>
        <p>
          Do not abuse the service, attempt unauthorized access, scrape at scale, or use the app in
          ways that harm other users or our infrastructure.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">5. Disclaimer of warranties</h2>
        <p>
          The service is provided &quot;as is&quot; without warranties of accuracy, uptime, or fitness for a
          particular purpose. Model outputs may be wrong; roster and league data may be incomplete.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">6. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, {STUDIO_NAME} is not liable for indirect,
          incidental, or consequential damages arising from use of {PRODUCT_NAME}.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">7. Changes</h2>
        <p>
          We may update these terms. Material changes may require you to accept an updated version
          when signing in. Continued use after notice constitutes acceptance where permitted by law.
        </p>
      </section>
      <section>
        <h2 className="hub-panel-subtitle">8. Contact</h2>
        <p>
          Questions: <a href="mailto:fourthdownlabs@gmail.com">fourthdownlabs@gmail.com</a>
        </p>
      </section>
    </LegalShell>
  );
}
