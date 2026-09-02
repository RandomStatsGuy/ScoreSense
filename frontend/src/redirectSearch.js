/** Keep invite/claim (and other) query strings when a route only redirects. */
export function withLocationSearch(to, search = "", hash = "") {
  return `${to}${search || ""}${hash || ""}`;
}

/** Email and text-link joins open Draft. Everything else keeps the weekly default. */
export function joinLandingPath(search = "") {
  const raw = typeof search === "string" && search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw || "");
  if (params.get("invite")?.trim() || params.get("claim")?.trim()) return "/hub/draft";
  return "/projections/weekly";
}
