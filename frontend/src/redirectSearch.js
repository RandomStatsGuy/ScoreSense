/** Keep invite/claim (and other) query strings when a route only redirects. */
export function withLocationSearch(to, search = "", hash = "") {
  return `${to}${search || ""}${hash || ""}`;
}

function searchParamsFrom(search = "") {
  const raw = typeof search === "string" && search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw || "");
}

/** Email and text-link joins open Draft. Everything else keeps the weekly default. */
export function joinLandingPath(search = "") {
  const params = searchParamsFrom(search);
  if (params.get("invite")?.trim() || params.get("claim")?.trim()) return "/hub/draft";
  return "/projections/weekly";
}

/** Keep only the join token when sending people to Draft. */
export function joinLandingSearch(search = "") {
  const params = searchParamsFrom(search);
  const next = new URLSearchParams();
  const invite = params.get("invite")?.trim();
  const claim = params.get("claim")?.trim();
  if (invite) next.set("invite", invite);
  if (claim) next.set("claim", claim);
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}
