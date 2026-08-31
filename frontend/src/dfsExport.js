/**
 * Lineup CSV exports (Tools → DFS).
 *
 * Site files match each site's bulk-entry parser:
 * - DraftKings reads position-headed rows with "Name (ID)" cells.
 * - FanDuel reads position-headed rows with "Id:Name" cells.
 * Paste rows over the placeholder players in the site's entries template,
 * or upload directly on the site's lineup-upload page.
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
  const remaining = [...rows];
  const ordered = [];
  for (const slot of slotOrder) {
    const idx = remaining.findIndex((row) => String(row.slot) === slot);
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
export function buildSiteLineupCsv(site, lineups = []) {
  const config = siteExportConfig(site);
  if (!config) {
    return { ok: false, reason: "This format has no site upload file — use the detail CSV." };
  }
  const entries = lineups.filter((entry) => entry?.lineup?.length);
  if (!entries.length) {
    return { ok: false, reason: "Build a lineup first." };
  }

  const lines = [config.headers.map(csvQuote).join(",")];
  for (const entry of entries) {
    const ordered = orderLineup(entry.lineup, config.slotOrder);
    if (!ordered) {
      return {
        ok: false,
        reason: "A lineup is missing a roster slot — rebuild and try again.",
      };
    }
    const missing = ordered.filter((row) => !row.dfs_id);
    if (missing.length) {
      return {
        ok: false,
        reason: `${config.label} player IDs are missing for ${missing.length} slot${missing.length === 1 ? "" : "s"}. Load a slate or import the ${config.label} salary CSV first.`,
      };
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
  const config = siteExportConfig(site);
  if (!config) return "This format exports the detail CSV only.";
  const entries = lineups.filter((entry) => entry?.lineup?.length);
  if (!entries.length) return "Build a lineup first.";
  for (const entry of entries) {
    if (entry.lineup.some((row) => !row.dfs_id)) {
      return `Load a slate or import the ${config.label} salary CSV to get player IDs.`;
    }
  }
  return "";
}
