export function claimTokenFromSearch(search) {
  const params = typeof search === "string"
    ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
    : new URLSearchParams(search || undefined);
  return params.get("claim")?.trim() || "";
}

export function dropClaimParam(searchParams) {
  const next = new URLSearchParams(searchParams || undefined);
  next.delete("claim");
  return next;
}
