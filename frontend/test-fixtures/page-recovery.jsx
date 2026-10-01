import React from "react";
import { createRoot } from "react-dom/client";
import PageRecoveryBoundary from "../src/PageRecoveryBoundary";
import "../src/styles/tokens.css";
import "../src/styles/product-hierarchy.css";

function FailedPage() { throw new Error("Fixture: rejected page import"); }
createRoot(document.getElementById("root")).render(
  <PageRecoveryBoundary><FailedPage /></PageRecoveryBoundary>
);
