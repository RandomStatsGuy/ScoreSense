import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppRouter from "./AppRouter";
import AuthGate from "./AuthGate";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthGate>
        <AppRouter />
      </AuthGate>
    </BrowserRouter>
  </React.StrictMode>
);
