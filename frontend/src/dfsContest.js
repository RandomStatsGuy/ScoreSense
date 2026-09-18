/**
 * Post-contest analysis of a DraftKings contest-standings export (Tools → DFS).
 *
 * The export is two tables side by side, separated by one blank column:
 *   Rank,EntryId,EntryName,TimeRemaining,Points,Lineup,,Player,Roster Position,%Drafted,FPTS
 * The two halves have independent row counts, so neither may be read as rows of
 * the other. The import path reads only the left half; everything here works
 * from the right half plus the lineup strings.
 *
 * The file carries no prize money. Payouts come from a structure the user
 * pastes from the contest page, never from inference.
 */

const SLOT_WORDS = ["CPT", "MVP", "FLEX", "QB", "RB", "WR", "TE", "DST", "DEF", "K"];
const SLOT_RE = new RegExp(`(?:^|\\s)(${SLOT_WORDS.join("|")})\\s`, "g");

/** Split "CPT A Name FLEX B Name" into slots. Player names may contain spaces. */
export function parseLineupSlots(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const marks = [];
  SLOT_RE.lastIndex = 0;
  let match = SLOT_RE.exec(raw);
  while (match) {
    marks.push({ slot: match[1], from: match.index + match[0].length });
    SLOT_RE.lastIndex = match.index + match[0].length - 1;
    match = SLOT_RE.exec(raw);
  }
  return marks.map((mark, i) => ({
    slot: mark.slot,
    player: raw.slice(mark.from, i + 1 < marks.length ? marks[i + 1].from - marks[i + 1].slot.length - 2 : undefined).trim(),
  })).filter((row) => row.player);
}

/** Order-independent identity of a lineup, for counting duplicates. */
export function lineupKey(slots = []) {
  const captain = slots.find((s) => s.slot === "CPT" || s.slot === "MVP");
  const rest = slots
    .filter((s) => s !== captain)
    .map((s) => s.player.toLowerCase())
    .sort();
  return JSON.stringify([captain ? captain.player.toLowerCase() : "", rest]);
}

const MONEY_RE = /\$?\s*([\d,]+(?:\.\d{1,2})?)/;
const RANGE_RE = /^\s*(\d+)(?:st|nd|rd|th)?\s*(?:[-–—]|to)?\s*(\d+)?(?:st|nd|rd|th)?\s*$/i;

/**
 * Read a payout table pasted from the contest page.
 * Accepts "1st  $2,000", "4th - 5th  $250.00", "6-10 100".
 * Returns ranges in cents, ascending, with no gaps invented.
 */
export function parsePrizeStructure(text) {
  const tiers = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split(/\t|\s{2,}|\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const money = MONEY_RE.exec(parts[parts.length - 1]);
    const range = RANGE_RE.exec(parts[0]);
    if (!money || !range) continue;
    const from = Number(range[1]);
    const to = range[2] ? Number(range[2]) : from;
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) continue;
    tiers.push({ from, to, cents: Math.round(Number(money[1].replace(/,/g, "")) * 100) });
  }
  tiers.sort((a, b) => a.from - b.from);
  return tiers;
}

/** Prize for one finishing position, or 0 when that position is outside the money. */
export function prizeForPosition(tiers, position) {
  for (const tier of tiers) {
    if (position >= tier.from && position <= tier.to) return tier.cents;
  }
  return 0;
}

/**
 * Split prize money across ties the way DraftKings does.
 *
 * Tied entries share a rank and the ranks behind them are skipped, so N entries
 * tied at rank R occupy positions R..R+N-1. The prizes for those positions are
 * pooled and divided evenly. Looking up the prize for R alone overpays every tie.
 */
export function payoutsByRank(ranks = [], tiers = []) {
  const counts = new Map();
  for (const rank of ranks) {
    const r = Number(rank);
    if (Number.isFinite(r)) counts.set(r, (counts.get(r) || 0) + 1);
  }
  const out = new Map();
  for (const [rank, count] of counts) {
    let pool = 0;
    for (let pos = rank; pos < rank + count; pos += 1) pool += prizeForPosition(tiers, pos);
    out.set(rank, Math.round(pool / count));
  }
  return out;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Describe one contest: how the field scored, how duplicated it was, what it
 * owned, and where the viewer's own entries landed.
 *
 * `mine` is a set of entry IDs. Everything else describes the whole field, so
 * the same result serves both the personal review and the contest post-mortem.
 */
export function contestSummary({ entries = [], players = [], mine = [], tiers = [] } = {}) {
  const mineIds = new Set(mine.map(String));
  const rows = entries
    .map((e) => ({
      entry_id: String(e.entry_id ?? ""),
      entry_name: String(e.entry_name ?? ""),
      rank: Number(e.rank),
      points: Number(e.points),
      slots: parseLineupSlots(e.lineup),
    }))
    .filter((r) => Number.isFinite(r.rank));
  for (const row of rows) row.key = lineupKey(row.slots);

  const dupes = new Map();
  for (const row of rows) dupes.set(row.key, (dupes.get(row.key) || 0) + 1);
  const payouts = payoutsByRank(rows.map((r) => r.rank), tiers);

  // Exposure is counted per roster slot so a captain is not mixed with a flex,
  // matching how DraftKings reports %Drafted.
  const mineRows = rows.filter((r) => mineIds.has(r.entry_id));
  const mineExposure = new Map();
  for (const row of mineRows) {
    for (const slot of row.slots) {
      const captain = slot.slot === "CPT" || slot.slot === "MVP";
      const key = `${slot.player.toLowerCase()}|${captain ? "CPT" : "FLEX"}`;
      mineExposure.set(key, (mineExposure.get(key) || 0) + 1);
    }
  }

  const ownership = players.map((p) => {
    const captain = String(p.roster_position || "").toUpperCase() === "CPT";
    const used = mineExposure.get(`${p.player.toLowerCase()}|${captain ? "CPT" : "FLEX"}`) || 0;
    const minePct = mineRows.length ? (used / mineRows.length) * 100 : null;
    return {
      ...p,
      mine_count: used,
      mine_pct: minePct,
      // Positive means more exposure than the field had.
      leverage: minePct == null || p.drafted_pct == null ? null : minePct - p.drafted_pct,
    };
  });

  const scores = rows.map((r) => r.points).filter(Number.isFinite).sort((a, b) => a - b);
  const worseThan = (pts) => scores.filter((s) => s < pts).length;

  return {
    field: {
      entries: rows.length,
      unique_lineups: dupes.size,
      score_min: scores.length ? scores[0] : null,
      score_max: scores.length ? scores[scores.length - 1] : null,
      score_median: median(scores),
      paid_entries: tiers.length
        ? rows.filter((r) => (payouts.get(r.rank) || 0) > 0).length
        : null,
    },
    ownership,
    mine: mineRows.map((r) => ({
      entry_id: r.entry_id,
      entry_name: r.entry_name,
      rank: r.rank,
      points: r.points,
      payout_cents: tiers.length ? payouts.get(r.rank) ?? 0 : null,
      // Share of the field this entry finished ahead of.
      percentile: rows.length ? (worseThan(r.points) / rows.length) * 100 : null,
      duplicates: (dupes.get(r.key) || 1) - 1,
    })),
  };
}
