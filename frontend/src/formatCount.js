/** One helper for seat / manager / team / franchise counts. */

const IRREGULAR = {
  person: "people",
};

export function formatCount(n, singular, plural = "") {
  const count = Number.isFinite(Number(n)) ? Number(n) : 0;
  const word =
    count === 1
      ? singular
      : plural || IRREGULAR[singular] || `${singular}s`;
  return `${count} ${word}`;
}
