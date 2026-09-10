// Production navigation components, without page data or authentication requests.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import ProductSubnav from "../src/layout/ProductSubnav";
import MobileHeader from "../src/layout/MobileHeader";
import MobileDestinationSheet from "../src/layout/MobileDestinationSheet";
import UserMenu from "../src/layout/UserMenu";
import useMobileLayout from "../src/useMobileLayout";
import { APP_SECTIONS, PROJECTIONS_TABS, TOOLS_TABS, SKIP_TO_CONTENT } from "../src/appNavigation";
import { projectionDestinationItems, toolDestinationItems } from "../src/layout/mobileChromePresentation";
import { buildAppPath } from "../src/routes";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";

function Preview() {
  const query = new URLSearchParams(location.search);
  const [view, setView] = useState(query.get("view") || "projections");
  const [projection, setProjection] = useState(query.get("tab") || "weekly");
  const [tool, setTool] = useState(query.get("tab") || "dfs");
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState({ ready: true, authenticated: true, name: "Kheylub" });
  const mobile = useMobileLayout();
  const isProjection = view === "projections";
  const active = isProjection ? projection : tool;
  const navigate = isProjection ? setProjection : setTool;
  const title = (isProjection ? PROJECTIONS_TABS : TOOLS_TABS).find(t => t.id === active)?.label;
  window.__setAuth = setAuth;
  const pathForSection = section => buildAppPath({ view: section, projectionsTab: projection, toolsTab: tool });
  return <div className="app">
    <a className="app-skip-link" href="#main-content">{SKIP_TO_CONTENT}</a>
    <header className="app-header app-header--product"><div className="app-header-shell">
      <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={APP_SECTIONS} view={view} pathForSection={pathForSection} onNavigate={setView}>
        <UserMenu authReady={auth.ready} authenticated={auth.authenticated} user={{ name: auth.name }} view={view} openSignIn={() => { window.__signIn = true; }} />
      </DesktopPrimaryHeader>
      {mobile ? <MobileHeader title={title} hasMenu menuOpen={open} onTitleClick={() => setOpen(true)} /> : <ProductSubnav view={view} active={active} seasonMode={query.get("mode") || "preseason"} onNavigate={navigate} />}
    </div></header>
    <main id="main-content" tabIndex={-1} style={{ padding: "var(--space-6) var(--space-3)" }}><h1>{title}</h1><p>Header preview · Sample account</p></main>
    <MobileDestinationSheet open={open} onClose={() => setOpen(false)} title={isProjection ? "Projections" : "Tools"} groups={[{ id: view, items: isProjection ? projectionDestinationItems() : toolDestinationItems() }]} active={active} onSelect={navigate} />
  </div>;
}
createRoot(document.getElementById("root")).render(<Preview />);
