/** Attribute-safe player id for querySelector. Falls back when CSS.escape is missing (older JSDOM / Node tests). */
export function escapePlayerIdSelector(playerId) {
  const raw = String(playerId);
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw;
}
