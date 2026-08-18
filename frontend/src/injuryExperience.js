/**
 * SCORE-25 — partition weekly Injuries UX into attention / opportunity / all.
 * Uses injuries + projection slate (and optional player-context) only — no live Sleeper.
 */

import {
  formatOppPoints,
  shouldShowProjectionAssumesActive,
} from "./playerContextDisplay.js";
import { pickOpportunityAdjustment } from "./opportunityAdjustment.js";

const SEVERITY_ORDER = {
  Out: 0,
  IR: 1,
  PUP: 2,
  Doubtful: 3,
  Questionable: 4,
};

const FANTASY_POS = new Set(["QB", "RB", "FB", "WR", "TE"]);

const DRIVER_SEGMENT_RE =
  /^(?<name>.+?)\s*\((?<status>[^)]+)\)\s*$/;

/** Compact status label for narrow cards; full status stays in title/aria. */
export function injuryStatusShort(status) {
  const s = String(status || "").trim();
  const lower = s.toLowerCase();
  if (lower.includes("questionable")) return "Q";
  if (lower.includes("doubtful")) return "D";
  if (lower.includes("probable")) return "P";
  if (/(^|\s)out(\s|$)/i.test(s)) return "Out";
  if (/\bir\b/i.test(s)) return "IR";
  if (/\bpup\b/i.test(s)) return "PUP";
  return s.length > 8 ? `${s.slice(0, 7)}…` : s;
}

export function injuryCardClass(status) {
  const s = String(status || "").toLowerCase();
  if (/(out|ir|pup|inactive|suspended)/.test(s)) return "injury-card injury-card--severe";
  if (s.includes("doubtful")) return "injury-card injury-card--doubtful";
  if (s.includes("questionable")) return "injury-card injury-card--questionable";
  return "injury-card injury-card--default";
}

export function sortInjuriesBySeverity(players) {
  return [...(players || [])].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.injury_status] ?? 99;
    const sb = SEVERITY_ORDER[b.injury_status] ?? 99;
    if (sa !== sb) return sa - sb;
    return String(a.full_name || "").localeCompare(String(b.full_name || ""));
  });
}

export function playerKey(name, team) {
  return `${String(name || "").trim().toLowerCase()}|${String(team || "").trim().toUpperCase()}`;
}

export function practiceLabel(injury) {
  const raw =
    injury?.practice_participation
    || injury?.practice_description
    || injury?.practice
    || "";
  const text = String(raw).trim();
  return text || null;
}

/**
 * Parse "Name (Status); Name (Status)" injury notes into driver objects.
 */
export function parseInjuryNoteDrivers(note) {
  const text = String(note || "").trim();
  if (!text) return [];
  const out = [];
  const seen = new Set();
  for (const segment of text.split(";")) {
    const part = segment.trim();
    if (!part) continue;
    const match = DRIVER_SEGMENT_RE.exec(part);
    const name = (match?.groups?.name || part).trim();
    const status = (match?.groups?.status || "").trim() || null;
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, status, slug: slugifyName(name) });
  }
  return out;
}

export function slugifyName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Estimate absolute point delta from boosted projection + opportunity adjustment fraction. */
export function estimateOpportunityPoints(projectedPoints, opportunityAdjustment) {
  const pts = Number(projectedPoints);
  const boost = Number(opportunityAdjustment);
  if (!Number.isFinite(pts) || !Number.isFinite(boost) || boost <= 0) return null;
  const delta = (pts * boost) / (1 + boost);
  return Math.round(delta * 10) / 10;
}

/**
 * Fantasy-relevant injured players on the current projection slate ("Needs your attention").
 */
export function buildAttentionItems({ injuries, projections, contextById }) {
  const projByKey = new Map();
  for (const row of projections || []) {
    const key = playerKey(row.Player, row.Team);
    if (key !== "|") projByKey.set(key, row);
  }

  const items = [];
  for (const injury of injuries || []) {
    const key = playerKey(injury.full_name, injury.team);
    const row = projByKey.get(key);
    if (!row) continue;

    const pid = row.player_id != null ? String(row.player_id) : "";
    const context = pid && contextById ? contextById.get(pid) : null;
    const status = injury.injury_status || row["Injury Status"] || context?.availability?.status || null;
    const practice =
      practiceLabel(injury)
      || context?.availability?.practice
      || null;
    const changedAt =
      injury.news_updated
      ?? context?.availability?.updated_at
      ?? null;

    let assumesActive = false;
    if (context) {
      assumesActive = shouldShowProjectionAssumesActive(context);
    } else if (status && /questionable|doubtful/i.test(String(status))) {
      assumesActive = true;
    }

    items.push({
      key: injury.sleeper_id || key,
      injury,
      projectionRow: row,
      playerId: pid || null,
      status,
      practice,
      changedAt,
      assumesActive,
      bodyPart: String(injury.injury_body_part || "").trim() || null,
      notes: String(injury.injury_notes || "").trim() || null,
    });
  }

  return sortInjuriesBySeverity(items.map((i) => ({ ...i.injury, __item: i }))).map(
    (wrapped) => wrapped.__item,
  );
}

/**
 * Healthy beneficiaries with a material opportunity bump + fantasy skill driver.
 * Prefers player-context deltas; falls back to projection Opportunity Adjustment + Injury Note.
 */
export function buildOpportunityItems({
  projections,
  injuries,
  contextById,
  minPoints = 0.5,
}) {
  const injuryByName = new Map();
  const injuryBySlug = new Map();
  const injuryByGsis = new Map();
  for (const inj of injuries || []) {
    const name = String(inj.full_name || "").trim();
    if (name) injuryByName.set(name.toLowerCase(), inj);
    const slug = slugifyName(name);
    if (slug) injuryBySlug.set(slug, inj);
    const gsis = String(inj.gsis_id || "").trim();
    if (gsis) injuryByGsis.set(gsis, inj);
  }

  const resolveDriver = (token) => {
    const raw = String(token || "").trim();
    if (!raw) return null;
    if (injuryByGsis.has(raw)) return injuryByGsis.get(raw);
    const lower = raw.toLowerCase();
    if (injuryByName.has(lower)) return injuryByName.get(lower);
    const slug = slugifyName(raw);
    if (injuryBySlug.has(slug)) return injuryBySlug.get(slug);
    return null;
  };

  const isFantasyDriver = (inj) => FANTASY_POS.has(String(inj?.position || "").toUpperCase());

  const items = [];
  const seen = new Set();

  for (const row of projections || []) {
    const status = String(row["Injury Status"] || "").trim();
    if (status) continue; // healthy beneficiaries only

    const pid = row.player_id != null ? String(row.player_id) : "";
    const context = pid && contextById ? contextById.get(pid) : null;
    const opp = context?.opportunity_adjustment;

    let points = null;
    let drivers = [];
    let included = false;

    if (opp?.included) {
      const n = Number(opp.points);
      if (Number.isFinite(n) && n >= minPoints) {
        points = Math.round(n * 10) / 10;
        included = true;
        for (const token of opp.drivers || []) {
          const inj = resolveDriver(token);
          if (inj && isFantasyDriver(inj)) {
            drivers.push({
              name: inj.full_name,
              status: inj.injury_status || null,
              injury: inj,
            });
          } else if (!inj && typeof token === "string" && token.includes("-")) {
            // Keep unresolved slug as readable fallback
            drivers.push({
              name: String(token).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              status: null,
              injury: null,
            });
          }
        }
      }
    }

    if (!included) {
      const boost = pickOpportunityAdjustment(row);
      if (boost == null || !Number.isFinite(boost) || boost <= 0) continue;
      const noteDrivers = parseInjuryNoteDrivers(row["Injury Note"]);
      const fantasyDrivers = [];
      for (const d of noteDrivers) {
        const inj = resolveDriver(d.name) || resolveDriver(d.slug);
        if (inj && isFantasyDriver(inj)) {
          fantasyDrivers.push({
            name: inj.full_name,
            status: inj.injury_status || d.status,
            injury: inj,
          });
        }
      }
      if (!fantasyDrivers.length) continue;
      const est = estimateOpportunityPoints(row["Projected Points"], boost);
      if (est == null || est < minPoints) continue;
      points = est;
      drivers = fantasyDrivers;
      included = true;
    }

    if (!included || !drivers.length) continue;

    const key = pid || playerKey(row.Player, row.Team);
    if (seen.has(key)) continue;
    seen.add(key);

    const primary = drivers[0];
    items.push({
      key,
      playerId: pid || null,
      name: row.Player,
      team: row.Team,
      position: row.Position,
      points,
      pointsLabel: formatOppPoints(points),
      drivers,
      driverLabel: primary
        ? (primary.status
          ? `${primary.name} · ${primary.status}`
          : `${primary.name} injured`)
        : null,
      projectionRow: row,
    });
  }

  return items.sort((a, b) => (b.points || 0) - (a.points || 0));
}

/**
 * Same-team / same-position healthy replacements for compare seeding.
 */
export function pickReplacementCandidates(injuredRow, projections, { limit = 2 } = {}) {
  if (!injuredRow) return [];
  const team = String(injuredRow.Team || injuredRow.team || "").toUpperCase();
  const pos = String(injuredRow.Position || injuredRow.position || "").toUpperCase();
  const injuredId = injuredRow.player_id != null ? String(injuredRow.player_id) : "";
  const injuredName = String(injuredRow.Player || injuredRow.full_name || "").toLowerCase();

  const posGroup = (p) => {
    const u = String(p || "").toUpperCase();
    if (u === "FB") return "RB";
    if (u === "TE") return "WR";
    return u;
  };
  const targetGroup = posGroup(pos);

  return [...(projections || [])]
    .filter((row) => {
      const pid = row.player_id != null ? String(row.player_id) : "";
      if (injuredId && pid === injuredId) return false;
      if (!injuredId && String(row.Player || "").toLowerCase() === injuredName) return false;
      if (String(row.Team || "").toUpperCase() !== team) return false;
      if (posGroup(row.Position) !== targetGroup) return false;
      if (String(row["Injury Status"] || "").trim()) return false;
      return Boolean(pid);
    })
    .sort((a, b) => Number(b["Projected Points"] || 0) - Number(a["Projected Points"] || 0))
    .slice(0, limit);
}

export function filterInjuriesByQuery(injuries, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return injuries || [];
  return (injuries || []).filter((p) => {
    const blob = [
      p.full_name,
      p.team,
      p.position,
      p.injury_status,
      p.injury_body_part,
      p.injury_notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });
}
