/**
 * Lineup CSV exports (Tools → DFS).
 *
 * Lineup-library upload files:
 * - DraftKings reads position-headed rows with "Name (ID)" cells.
 * - FanDuel reads position-headed rows with "Id:Name" cells.
 * These files do not contain reserved-entry IDs or contest metadata. They
 * must not be presented as files for editing existing contest entries.
 */

import { csvQuote } from "./table/csv.js";

const CLASSIC_SLOT_ORDER = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const CAPTAIN_FLEX_ORDER = ["FLEX1", "FLEX2", "FLEX3", "FLEX4", "FLEX5"];

export const SITE_EXPORTS = {
  draftkings: {
    label: "DraftKings",
    filename: "draftkings-lineups",
    headers: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"],
    slotOrder: CLASSIC_SLOT_ORDER,
    cell: (row) => `${row.player} (${row.dfs_id})`,
  },
  fanduel: {
    label: "FanDuel",
    filename: "fanduel-lineups",
    headers: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DEF"],
    slotOrder: CLASSIC_SLOT_ORDER,
    cell: (row) => `${row.dfs_id}:${row.player}`,
  },
  draftkings_showdown: {
    label: "DraftKings",
    filename: "draftkings-showdown-lineups",
    headers: ["CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"],
    slotOrder: ["CPT", ...CAPTAIN_FLEX_ORDER],
    cell: (row) => `${row.player} (${row.dfs_id})`,
  },
  fanduel_single: {
    label: "FanDuel",
    filename: "fanduel-single-game-lineups",
    headers: ["MVP", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"],
    slotOrder: ["MVP", ...CAPTAIN_FLEX_ORDER],
    cell: (row) => `${row.dfs_id}:${row.player}`,
  },
};

export function siteExportConfig(site) {
  return SITE_EXPORTS[site] || null;
}

function orderLineup(rows = [], slotOrder = CLASSIC_SLOT_ORDER) {
  if (!Array.isArray(rows) || rows.length !== slotOrder.length) return null;
  const remaining = [...rows];
  const ordered = [];
  for (const slot of slotOrder) {
    const idx = remaining.findIndex((row) => String(row?.slot) === slot);
    if (idx === -1) return null;
    ordered.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return ordered;
}

/**
 * Build a site upload CSV for one or more lineups.
 * Returns { ok: true, lines, filename } or { ok: false, reason }.
 */
export function buildSiteLineupCsv(site, lineups = [], salaryCatalog = null) {
  const config = siteExportConfig(site);
  if (!config) {
    return { ok: false, reason: "This format has no site upload file — use the detail CSV." };
  }
  if (!Array.isArray(lineups) || !lineups.length) {
    return { ok: false, reason: "Build a lineup first." };
  }
  const entries = lineups;
  const isDraftKings = site.startsWith("draftkings");
  if (isDraftKings && entries.length > 500) {
    return { ok: false, reason: "DraftKings accepts up to 500 lineups per upload. Export a smaller set." };
  }

  const lines = [config.headers.map(csvQuote).join(",")];
  for (const entry of entries) {
    const ordered = orderLineup(entry?.lineup, config.slotOrder);
    if (!ordered) {
      return {
        ok: false,
        reason: "A lineup has missing, extra, or repeated roster slots. Rebuild and try again.",
      };
    }
    const missing = ordered.filter((row) => !String(row.dfs_id ?? "").trim());
    if (missing.length) {
      return {
        ok: false,
        reason: `${config.label} player IDs are missing for ${missing.length} slot${missing.length === 1 ? "" : "s"}. Load a slate or import the ${config.label} salary CSV first.`,
      };
    }
    if (ordered.some((row) => !String(row.player ?? "").trim() ||
      (isDraftKings && !/^[1-9]\d*$/.test(String(row.dfs_id))))) {
      return { ok: false, reason: "A player name or upload ID is invalid. Reload the site's salary file; keep IDs as text when editing CSVs." };
    }
    if (salaryCatalog) {
      const catalogMatches = ordered.every(row => salaryCatalog.some(player => {
        const captain = row.slot === "CPT";
        const expectedId = captain ? player.cpt_dfs_id : row.slot === "MVP" ? (player.cpt_dfs_id || player.dfs_id) : player.dfs_id;
        const expectedSalary = captain ? player.cpt_salary : row.slot === "MVP" ? (player.cpt_salary ?? player.salary) : player.salary;
        return expectedId != null && String(expectedId) === String(row.dfs_id)
          && Number(expectedSalary) === Number(row.salary);
      }));
      if (!catalogMatches) return { ok: false, reason: "A player ID, roster slot or salary does not match the loaded slate. Reload salaries and rebuild before exporting." };
    }
    const ids = new Set();
    const athletes = new Set();
    for (const row of ordered) {
      // Captain and FLEX have different draftable IDs for the same athlete.
      const athlete = String(row.player_id || `${String(row.player).trim().toLowerCase()}|${String(row.team).trim().toUpperCase()}`);
      if (ids.has(String(row.dfs_id)) || athletes.has(athlete)) {
        return { ok: false, reason: "A lineup includes the same player more than once. Rebuild and try again." };
      }
      ids.add(String(row.dfs_id));
      athletes.add(athlete);
    }
    if (ordered.some((row) => !Number.isSafeInteger(Number(row.salary)) || Number(row.salary) <= 0)) {
      return { ok: false, reason: "A lineup has a missing or invalid salary. Reload the slate before exporting." };
    }
    const cap = isDraftKings ? 50000 : 60000;
    if (ordered.reduce((sum, row) => sum + Number(row.salary), 0) > cap) {
      return { ok: false, reason: `A lineup exceeds ${config.label}'s $${cap.toLocaleString("en-US")} salary cap.` };
    }
    if (site === "draftkings_showdown") {
      const teams = new Set(ordered.map(row => String(row.team ?? "").trim().toUpperCase()));
      if (teams.has("") || teams.size !== 2) {
        return { ok: false, reason: "A Showdown lineup must include players from both teams in one game." };
      }
    }
    lines.push(ordered.map((row) => csvQuote(config.cell(row))).join(","));
  }
  return { ok: true, lines, filename: config.filename };
}

/** Detail CSV — every slot with salary and projection columns, one row per slot. */
export function buildLineupDetailCsv(lineups = [], { isDfs = true } = {}) {
  const entries = lineups.filter((entry) => entry?.lineup?.length);
  if (!entries.length) {
    return { ok: false, reason: "Build a lineup first." };
  }
  const headers = ["Lineup", "Slot", "Player", "Team", "Pos"];
  if (isDfs) headers.push("Salary", "Value");
  headers.push("Proj", "Floor", "Ceiling");

  const lines = [headers.map(csvQuote).join(",")];
  entries.forEach((entry, index) => {
    for (const row of entry.lineup) {
      const cells = [index + 1, row.slot, row.player, row.team, row.position];
      if (isDfs) cells.push(row.salary ?? "", row.value ?? "");
      cells.push(row.proj ?? "", row.floor ?? "", row.ceiling ?? "");
      lines.push(cells.map(csvQuote).join(","));
    }
  });
  return { ok: true, lines, filename: "scoresense-lineups" };
}

/** Disabled-state reason for the site export button, or "" when exportable. */
export function siteExportDisabledReason(site, lineups = []) {
  const result = buildSiteLineupCsv(site, lineups);
  return result.ok ? "" : result.reason;
}
