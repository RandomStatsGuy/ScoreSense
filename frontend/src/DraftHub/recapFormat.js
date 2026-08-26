/** Pick-draft recap presentation helpers. */

const AUCTION_LANGUAGE = [
  /\bcap hoarder\b/i,
  /\bempty wallet\b/i,
  /\bamount spent\b/i,
  /\bfair salary\b/i,
  /\bauction wins\b/i,
  /\bnotable sales\b/i,
  /\bsuggested bid\b/i,
  /\bsalary cap\b/i,
  /\bunspent\b/i,
  /\$\d/,
];

export function recapHeadlineForType(draftType) {
  const t = String(draftType || "").toLowerCase();
  if (t === "linear") return "Linear draft in the books.";
  if (t === "snake") return "Snake draft in the books.";
  return "Draft in the books.";
}

export function containsAuctionLanguage(text) {
  const s = String(text || "");
  return AUCTION_LANGUAGE.some((re) => re.test(s));
}

export function recapCopyIsPickDraftSafe(recap) {
  if (!recap || !recap.pick_draft) return true;
  const blobs = [
    recap.headline,
    recap.subheadline,
    recap.methodology,
    recap.outcome_note,
    ...(recap.awards || []).flatMap((a) => [a.title, a.detail, a.blurb]),
  ];
  return !blobs.some(containsAuctionLanguage);
}

export function formatExpectedRecord(row, recordGames = 14) {
  const wins = Number(row?.expected_wins);
  const losses = Number(row?.expected_losses);
  if (!Number.isFinite(wins)) return "—";
  const w = wins.toFixed(1);
  const l = Number.isFinite(losses) ? losses.toFixed(1) : (Number(recordGames) - wins).toFixed(1);
  return `${w}–${l}`;
}

export function formatPlayoffPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export function sortStandings(rows, key = "rank", dir = "asc") {
  const list = [...(rows || [])];
  const sign = dir === "desc" ? -1 : 1;
  list.sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * sign;
    }
    return av > bv ? sign : av < bv ? -sign : 0;
  });
  return list;
}

export function outcomeBandLabel(key) {
  if (key === "points_p10") return "Floor / P10";
  if (key === "points_p50") return "Median / P50";
  if (key === "points_p90") return "Ceiling / P90";
  return key;
}

export function viewerInsight(recap, viewerTeamId) {
  const tid = viewerTeamId != null ? String(viewerTeamId) : "";
  if (!tid) return (recap?.team_insights || [])[0] || null;
  return (recap?.team_insights || []).find((row) => String(row.team_id) === tid) || null;
}
