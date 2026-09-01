import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AnalyticsListener from "./AnalyticsListener";
import AppRouter from "./AppRouter";
import AuthGate from "./AuthGate";
import "./styles.css";
import "./styles/product-hierarchy.css";
import "./styles/projections-experience.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AnalyticsListener />
      <AuthGate>
        <AppRouter />
      </AuthGate>
    </BrowserRouter>
  </React.StrictMode>
);
