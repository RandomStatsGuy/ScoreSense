/**
 * Turning one contest breakdown into records the account keeps.
 *
 * Two separate writes, because they answer different questions later:
 *   - entry rows go to the existing results ledger, which is what the money
 *     cards and the completeness counter read;
 *   - a contest snapshot keeps the breakdown itself, so it reopens without the
 *     CSV and without re-pasting the payout table.
 *
 * Everything here is derived from the file or typed by the user. A number that
 * is not known stays absent rather than becoming zero — an entry with no payout
 * table must not be recorded as having won nothing.
 */

const MAX_LINEUP_TEXT = 4000;

/**
 * A calendar date the way the ledger stores it, from local clock parts.
 *
 * Never toISOString(): that is UTC, and a contest broken down on a weeknight
 * evening in the US would be filed under tomorrow.
 */
export function localDateString(date = new Date()) {
  if (Number.isNaN(date?.getTime?.())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Entry rows for POST /api/lineup/results/import.
 *
 * Only the viewer's own entries, and only fields the file actually carries.
 * `status` is claimed only when a payout table made the money real; the
 * standings file alone says where an entry finished, not what it was paid.
 */
export function contestEntryRows({
  mine = [],
  site = "draftkings",
  contestId = "",
  contestName = "",
  feeCents = null,
  date = "",
} = {}) {
  if (!contestId) return [];
  return mine
    .filter((row) => row.entry_id)
    .map((row) => {
      const paid = Number.isInteger(row.payout_cents);
      const entry = {
        site,
        contest_id: String(contestId),
        entry_id: String(row.entry_id),
      };
      if (contestName) entry.contest_name = contestName;
      // Money with no date is money the returns chart cannot plot.
      if (date) entry.date = date;
      if (row.entry_name) entry.entry_name = row.entry_name;
      if (Number.isFinite(row.rank)) entry.rank = row.rank;
      if (Number.isFinite(row.points)) entry.points = row.points;
      if (row.lineup_text) entry.lineup_text = String(row.lineup_text).slice(0, MAX_LINEUP_TEXT);
      if (Number.isInteger(feeCents)) entry.fee_cents = feeCents;
      if (paid) {
        entry.payout_cents = row.payout_cents;
        entry.status = "settled";
      }
      return entry;
    });
}

/** Totals over the viewer's entries, for the saved-contest list. */
export function myContestTotals(mine = [], feeCents = null) {
  const paid = mine.filter((row) => Number.isInteger(row.payout_cents));
  return {
    my_entries: mine.length,
    my_payout_cents: paid.length ? paid.reduce((sum, row) => sum + row.payout_cents, 0) : null,
    my_fee_cents: Number.isInteger(feeCents) ? feeCents * mine.length : null,
  };
}

/**
 * The body for POST /api/lineup/contests.
 *
 * The breakdown goes in whole under `summary`, so reopening a contest restores
 * exactly what was on screen. The counts beside it are denormalized because the
 * list view reads those and must never pull a whole slate to draw a row.
 */
export function contestSnapshot({
  summary = null,
  site = "draftkings",
  contestId = "",
  contestName = "",
  feeCents = null,
  date = "",
  tiers = [],
} = {}) {
  if (!summary || !contestId) return null;
  const mine = summary.mine || [];
  return {
    site,
    contest_id: String(contestId),
    contest_name: contestName || null,
    contest_date: date || null,
    entries: summary.field?.entries ?? 0,
    unique_lineups: summary.field?.unique_lineups ?? 0,
    ...myContestTotals(mine, feeCents),
    summary: {
      field: summary.field,
      ownership: summary.ownership || [],
      winners: summary.winners || {},
      mine,
    },
    tiers,
  };
}
