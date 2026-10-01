import React from "react";
import { PAGE_RECOVERY_COPY as C } from "./pageRecoveryPresentation";
import { clientRecoveryUrl, recoverClientPage } from "./clientRecovery";
import "./styles/page-recovery.css";

// Suspense handles pending imports; this handles rejected imports and render errors.
// Recover through the network shell: an ordinary reload can repeat the old
// worker's cached shell and React.lazy's failed import after a deployment.
// Editable screens retain this explicit action; automatic recovery is bounded.
export default class PageRecoveryBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main id="main-content" className="page-recovery" role="alert" aria-labelledby="page-recovery-heading">
      <h1 id="page-recovery-heading">{C.heading}</h1>
      <p>{C.support}</p>
      <div>
        <button type="button" onClick={() => recoverClientPage()}>{C.reload}</button>
        <a href={clientRecoveryUrl({ pathname: "/hub/home" })}>{C.home}</a>
      </div>
    </main>;
  }
}
