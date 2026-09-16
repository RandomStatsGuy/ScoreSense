import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AnalyticsListener from "./AnalyticsListener";
import AppRouter from "./AppRouter";
import AuthGate from "./AuthGate";
import PageRecoveryBoundary from "./PageRecoveryBoundary";
import "./styles.css";
import "./styles/product-hierarchy.css";
import "./styles/projections-experience.css";
import "./styles/product-rhythm.css";
import "./styles/fantasy-phone.css";
import "./styles/fantasy-header.css";
import "./styles/standalone-dialogs.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AnalyticsListener />
      <PageRecoveryBoundary><AuthGate>
        <AppRouter />
      </AuthGate></PageRecoveryBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
