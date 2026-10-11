import { parseDfsCsv, csvLines, headerKey } from "./dfsCsv.js";
import { buildSiteLineupCsv, siteExportConfig } from "./dfsExport.js";
import { validateGlobalBuildForExport } from "./dfsGlobalExportValidation.js";

export function readEntryTemplate(text, site) {
  if (!siteExportConfig(site) || !site.startsWith("draftkings"))
    throw new Error(
      "Reserved-entry editing currently supports DraftKings templates.",
    );
  const rows = parseDfsCsv(text, { preserveEmptyRows: true });
  const headerIndex = rows.findIndex(row => {
    const keys = row.map(headerKey);
    return ["entryid", "contestid", "contestname", "entryfee"].every(key => keys.includes(key));
  });
  const headers = rows[headerIndex] || [];
  const key = headers.map(headerKey);
  const entryCol = key.indexOf("entryid"),
    contestCol = key.indexOf("contestid");
  const nameCol = key.indexOf("contestname"),
    feeCol = key.indexOf("entryfee");
  if ([entryCol, contestCol, nameCol, feeCol].some((i) => i < 0))
    throw new Error(
      "Import the CSV from DraftKings’ Edit Entries page. A lineup or salary file has no reserved-entry IDs.",
    );
  const slots = siteExportConfig(site).headers;
  const start = headers.findIndex((_, i) =>
    slots.every((s, j) => headers[i + j]?.trim().toUpperCase() === s),
  );
  if (start < 0)
    throw new Error("The template's roster format does not match this build.");
  const entries = [],
    seen = new Set();
  rows.slice(headerIndex + 1).forEach((row, i) => {
    const id = row[entryCol]?.trim();
    if (!id) return;
    // Provider files can keep instructions beside/below the reservation rows.
    if (!/^\d+$/.test(id) && !row[contestCol]?.trim()) return;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(row[contestCol]?.trim() || ""))
      throw new Error(`Invalid entry or contest ID on row ${headerIndex + i + 2}.`);
    if (seen.has(id)) throw new Error("The template repeats an entry ID.");
    seen.add(id);
    entries.push({
      id,
      contestId: row[contestCol],
      contest: row[nameCol],
      fee: row[feeCol],
      rowIndex: headerIndex + i + 1,
    });
  });
  if (!entries.length)
    throw new Error("No reserved entries were found in this template.");
  // The side catalog begins after the ordered roster section. An unrelated
  // metadata column named ID must never become the eligible-player list.
  const catalogStart = start + slots.length;
  const playerCol = key.findIndex((value, i) => i >= catalogStart && ["nameid", "nameplusid"].includes(value));
  const idCol = key.findIndex((value, i) => i >= catalogStart && value === "id");
  const eligibleIds = new Set();
  rows.slice(headerIndex + 1).forEach((row) => {
    const id =
      idCol >= 0
        ? row[idCol]?.trim() || row[playerCol]?.match(/\((\d+)\)$/)?.[1]
        : row[playerCol]?.match(/\((\d+)\)$/)?.[1];
    if (/^\d+$/.test(id || "")) eligibleIds.add(id);
  });
  return { rows, entries, start, eligibleIds, site, headerIndex };
}

export function buildEntryCsv(
  template,
  lineups,
  assignments,
  salaryCatalog = null,
  { validation = null, buildSource = null } = {},
) {
  if (validation && (validation.mode !== "pre_lock" || validation.lockState !== "not_started")) {
    throw new Error("Late swap is not supported here. Unknown or started lock state blocks this entry update.");
  }
  if (!template?.entries?.length || !Array.isArray(template.rows) || !Array.isArray(lineups) ||
      !assignments || typeof assignments !== "object" || Array.isArray(assignments)) {
    throw new Error("Import an entry template and review the lineup assignments first.");
  }
  if (!template.eligibleIds?.size && !salaryCatalog?.length) {
    throw new Error("This template has no eligible-player catalog. Load the verified salary catalog for this exact slate before exporting.");
  }
  const globalBuild = buildSource ? validateGlobalBuildForExport(buildSource, lineups) : null;
  const known = new Map(template.entries.map((e) => [e.id, e]));
  const rows = template.rows.map((r) => [...r]);
  const selected = new Map();
  const changes = [];
  let changed = 0;
  for (const [entryId, lineupIndex] of Object.entries(assignments)) {
    if (lineupIndex === "" || lineupIndex == null) continue;
    const entry = known.get(entryId);
    const index = Number(lineupIndex);
    if (
      !entry ||
      !["number", "string"].includes(typeof lineupIndex) ||
      (typeof lineupIndex === "string" && !/^(0|[1-9]\d*)$/.test(lineupIndex)) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= lineups.length
    )
      throw new Error(
        "An entry assignment is no longer valid. Review the assignments again.",
      );
    if (selected.has(index)) throw new Error("Each selected lineup must have one distinct entry assignment; a lineup was assigned more than once.");
    selected.set(index, entryId);
    const csv = buildSiteLineupCsv(
      template.site,
      [lineups[index]],
      salaryCatalog,
    );
    if (!csv.ok) throw new Error(csv.reason);
    const cells = parseDfsCsv(csv.lines[1])[0];
    // Each site writes its own cell shape — "Name (ID)" or "ID:Name" — so
    // read the ID back with that site's own reader.
    const cellId = siteExportConfig(template.site)?.cellId;
    if (
      template.eligibleIds.size &&
      cellId &&
      cells.some((cell) => !template.eligibleIds.has(cellId(cell)))
    ) {
      throw new Error(
        "A player ID is not in this template's eligible-player list. Check the slate and Captain slots.",
      );
    }
    cells.forEach((cell, i) => {
      rows[entry.rowIndex][template.start + i] = cell;
    });
    changes.push({ entryId: entry.id, contestId: entry.contestId, contestName: entry.contest,
      fee: entry.fee, lineupIndex: index, rowIndex: entry.rowIndex,
      before: template.rows[entry.rowIndex].slice(template.start, template.start + cells.length),
      after: [...cells], playerIds: cells.map(cell => cellId(cell)) });
    changed++;
  }
  if (!changed)
    throw new Error("Assign at least one lineup to an entry first.");
  if (globalBuild && changed !== lineups.length) throw new Error("Global portfolio export requires an assignment for every approved lineup.");
  const lines = csvLines(rows);
  const preservedFormulaCells = [];
  rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    if (/^[\s\uFEFF]*[=+@-]/.test(cell) && cell === template.rows[rowIndex]?.[columnIndex])
      preservedFormulaCells.push({ rowIndex, columnIndex });
  }));
  return {
    lines,
    csv: `${lines.join("\r\n")}\r\n`,
    changed,
    filename: "draftkings-edit-entries",
    manifest: { schema: "scoresense_entry_export_v1", site: template.site, artifact: "entry_update",
      lifecycle: "csv_created", acceptance: "unconfirmed", assignments: changes.sort((a, b) => a.rowIndex - b.rowIndex),
      selectedEntryCount: changed, untouchedEntryCount: template.entries.length - changed,
      eligibilitySource: template.eligibleIds.size ? "entry_template" : "loaded_salary_catalog",
      lockEvidence: validation ? "provided_pre_lock_contract" : "not_supplied", preservedFormulaCells,
      ...(globalBuild ? { globalBuild } : {}) },
  };
}
