/** Keep invite/claim (and other) query strings when a route only redirects. */
export function withLocationSearch(to, search = "", hash = "") {
  return `${to}${search || ""}${hash || ""}`;
}
