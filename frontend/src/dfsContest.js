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

/**
 * Read one money amount typed by hand — an entry fee, say.
 *
 * Returns null rather than 0 for anything unreadable, because a fee the app
 * invented as free is worse than a fee it admits it does not have.
 */
export function parseMoneyCents(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const found = MONEY_RE.exec(raw);
  if (!found) return null;
  const cents = Math.round(Number(found[1].replace(/,/g, "")) * 100);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
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

/** Exposure is keyed per roster slot so a captain is never mixed with a flex. */
const exposureKey = (player, captain) =>
  `${String(player).toLowerCase()}|${captain ? "CPT" : "FLEX"}`;

const isCaptain = (slot) => slot === "CPT" || slot === "MVP";

/**
 * What the top of the leaderboard actually rostered.
 *
 * `topPct` is a share of the field, so 1 means the top 1%. Everyone tied on the
 * cutoff rank is kept — a tie is never split — so the group can be larger than
 * the share asked for. Its real size and cutoff are reported rather than
 * assumed, because on a duplicated showdown slate they often differ a lot.
 *
 * `minEntries` keeps the group from being one lucky lineup on a small field.
 * When the field is smaller than that, the group is the whole field and says so.
 */
export function winnersComposition(rows = [], { topPct = 1, minEntries = 20 } = {}) {
  const ranked = rows
    .filter((r) => Number.isFinite(r.rank))
    .sort((a, b) => a.rank - b.rank);
  if (!ranked.length) {
    return { top_pct: topPct, cutoff_rank: null, entries: 0, players: [] };
  }
  const want = Math.min(
    ranked.length,
    Math.max(minEntries, Math.ceil((ranked.length * topPct) / 100)),
  );
  const cutoff = ranked[want - 1].rank;
  const group = ranked.filter((r) => r.rank <= cutoff);

  const counts = new Map();
  for (const row of group) {
    for (const slot of row.slots || []) {
      const key = exposureKey(slot.player, isCaptain(slot.slot));
      const seen = counts.get(key);
      if (seen) seen.count += 1;
      else counts.set(key, { player: slot.player, slot: isCaptain(slot.slot) ? "CPT" : "FLEX", count: 1 });
    }
  }
  const players = [...counts.values()]
    .map((row) => ({ ...row, pct: (row.count / group.length) * 100 }))
    .sort((a, b) => b.count - a.count || a.player.localeCompare(b.player));

  return { top_pct: topPct, cutoff_rank: cutoff, entries: group.length, players };
}

/**
 * Choose which points on a scatter get a name printed beside them.
 *
 * Charting libraries do not move one label out of another's way, so a label on
 * every point — or on two points that landed on top of each other — is
 * unreadable. Heaviest first, and a point is skipped when an already-chosen
 * label sits within `minGap` of it once both axes are scaled to 0..1.
 */
export function spacedLabels(points = [], { limit = 6, minGap = 0.1 } = {}) {
  const usable = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!usable.length) return [];
  const span = (values) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return hi - lo || 1;
  };
  const xs = usable.map((p) => p.x);
  const ys = usable.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const dx = span(xs);
  const dy = span(ys);

  const picked = [];
  for (const point of [...usable].sort((a, b) => (b.weight ?? b.y) - (a.weight ?? a.y))) {
    if (picked.length >= limit) break;
    const nx = (point.x - x0) / dx;
    const ny = (point.y - y0) / dy;
    const crowded = picked.some((q) => Math.hypot(nx - q.nx, ny - q.ny) < minGap);
    if (!crowded) picked.push({ key: point.key, nx, ny });
  }
  return picked.map((p) => p.key);
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
export function contestSummary({ entries = [], players = [], mine = [], tiers = [], topPct = 1 } = {}) {
  const mineIds = new Set(mine.map(String));
  const rows = entries
    .map((e) => ({
      entry_id: String(e.entry_id ?? ""),
      entry_name: String(e.entry_name ?? ""),
      rank: Number(e.rank),
      points: Number(e.points),
      // Kept verbatim as well as parsed: saving an entry writes back the
      // lineup the file gave, not a string reassembled from the slots.
      lineup_text: String(e.lineup ?? ""),
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
      const key = exposureKey(slot.player, isCaptain(slot.slot));
      mineExposure.set(key, (mineExposure.get(key) || 0) + 1);
    }
  }

  const winners = winnersComposition(rows, { topPct });
  const winnersByKey = new Map(
    winners.players.map((w) => [exposureKey(w.player, w.slot === "CPT"), w]),
  );

  const ownership = players.map((p) => {
    const captain = String(p.roster_position || "").toUpperCase() === "CPT";
    const key = exposureKey(p.player, captain);
    const used = mineExposure.get(key) || 0;
    const minePct = mineRows.length ? (used / mineRows.length) * 100 : null;
    const won = winnersByKey.get(key);
    const winnersPct = winners.entries ? won?.pct ?? 0 : null;
    return {
      ...p,
      mine_count: used,
      mine_pct: minePct,
      // Positive means more exposure than the field had.
      leverage: minePct == null || p.drafted_pct == null ? null : minePct - p.drafted_pct,
      winners_count: won?.count ?? 0,
      winners_pct: winnersPct,
      // Positive means the top of the leaderboard was on this more than the field.
      winners_edge:
        winnersPct == null || p.drafted_pct == null ? null : winnersPct - p.drafted_pct,
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
    winners: {
      top_pct: winners.top_pct,
      cutoff_rank: winners.cutoff_rank,
      entries: winners.entries,
      whole_field: winners.entries >= rows.length,
    },
    mine: mineRows.map((r) => ({
      entry_id: r.entry_id,
      entry_name: r.entry_name,
      rank: r.rank,
      points: r.points,
      lineup_text: r.lineup_text,
      payout_cents: tiers.length ? payouts.get(r.rank) ?? 0 : null,
      // Share of the field this entry finished ahead of.
      percentile: rows.length ? (worseThan(r.points) / rows.length) * 100 : null,
      duplicates: (dupes.get(r.key) || 1) - 1,
    })),
  };
}
