import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AdminPortal from "../src/AdminPortal";
import { allowUnsavedNavigation } from "../src/unsavedNavigation";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") || "dark";
window.fixtureState = params.get("state") || "ready";
window.fixtureWrites = [];
let configured = params.has("configured");
let saved = configured;
let email = configured ? "saved@example.test" : "";
function connection() {
  return { id: "jira", label: "Jira", purpose: "Receives reports sent from Report a bug.", configured, can_check: true,
    fields: [{ id: "email", label: "Account email", secret: false, value: email, configured, source: saved ? "saved" : "missing" },
      { id: "api_token", label: "API token", secret: true, value: "", configured, source: saved ? "saved" : "missing" }] };
}
window.fetch = async (input, options = {}) => {
  const path = String(input);
  if (path === "/api/admin/connections" && !options.method) {
    if (window.fixtureState === "loading") return new Promise(() => {});
    if (window.fixtureState === "load-error") return Response.json({ detail: "Could not load connections." }, { status: 503 });
    return Response.json({ connections: [connection()] });
  }
  if (path.startsWith("/api/admin/connections/jira") && options.method) {
    window.fixtureWrites.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    await new Promise(resolve => setTimeout(resolve, 180));
    if (window.fixtureState === "save-error") return Response.json({ detail: "Could not save the connection." }, { status: 503 });
    if (path.endsWith("/check")) return Response.json({ ok: true, message: "Jira connection checked. No test report was sent." });
    if (options.method === "DELETE") { configured = false; saved = false; email = ""; }
    else { configured = true; saved = true; email = JSON.parse(options.body).values.email || email; }
    return Response.json(connection());
  }
  throw new Error(`Unexpected fixture request: ${path}`);
};
function Preview() {
  const [tab, setTab] = useState("connections");
  return <main id="main-content" className="admin-connections-fixture"><AdminPortal adminTab={tab}
    onAdminTabChange={async id => { if (await allowUnsavedNavigation(`/admin/${id}`)) setTab(id); }} /></main>;
}
createRoot(document.getElementById("root")).render(<Preview />);
