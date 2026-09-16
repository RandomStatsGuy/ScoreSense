import React from "react";
import { PAGE_RECOVERY_COPY as C } from "./pageRecoveryPresentation";
import "./styles/page-recovery.css";

// Suspense handles pending imports; this handles rejected imports and render errors.
// A full reload fetches the current asset manifest instead of retrying React.lazy's
// cached rejection. Keep recovery user-initiated to avoid offline reload loops.
export default class PageRecoveryBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="page-recovery" role="alert" aria-labelledby="page-recovery-heading">
      <h1 id="page-recovery-heading">{C.heading}</h1>
      <p>{C.support}</p>
      <div>
        <button type="button" onClick={() => window.location.reload()}>{C.reload}</button>
        <a href="/hub/home">{C.home}</a>
      </div>
    </main>;
  }
}
