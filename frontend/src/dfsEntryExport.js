import { parseDfsCsv, csvLines, headerKey } from "./dfsCsv.js";
import { buildSiteLineupCsv, siteExportConfig } from "./dfsExport.js";

export function readEntryTemplate(text, site) {
  if (!site.startsWith("draftkings"))
    throw new Error(
      "Reserved-entry editing currently supports DraftKings templates.",
    );
  const rows = parseDfsCsv(text);
  const headers = rows[0] || [];
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
  rows.slice(1).forEach((row, i) => {
    const id = row[entryCol]?.trim();
    if (!id) return;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(row[contestCol]?.trim() || ""))
      throw new Error(`Invalid entry or contest ID on row ${i + 2}.`);
    if (seen.has(id)) throw new Error("The template repeats an entry ID.");
    seen.add(id);
    entries.push({
      id,
      contestId: row[contestCol],
      contest: row[nameCol],
      fee: row[feeCol],
      rowIndex: i + 1,
    });
  });
  if (!entries.length)
    throw new Error("No reserved entries were found in this template.");
  const playerCol =
    key.indexOf("nameid") >= 0
      ? key.indexOf("nameid")
      : key.indexOf("nameplusid");
  const idCol = key.indexOf("id");
  const eligibleIds = new Set();
  rows.slice(1).forEach((row) => {
    const id =
      idCol >= 0
        ? row[idCol]?.trim()
        : row[playerCol]?.match(/\((\d+)\)$/)?.[1];
    if (/^\d+$/.test(id || "")) eligibleIds.add(id);
  });
  return { rows, entries, start, eligibleIds, site };
}

export function buildEntryCsv(
  template,
  lineups,
  assignments,
  salaryCatalog = null,
) {
  const known = new Map(template.entries.map((e) => [e.id, e]));
  const rows = template.rows.map((r) => [...r]);
  let changed = 0;
  for (const [entryId, lineupIndex] of Object.entries(assignments)) {
    if (lineupIndex === "" || lineupIndex == null) continue;
    const entry = known.get(entryId);
    const index = Number(lineupIndex);
    if (
      !entry ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= lineups.length
    )
      throw new Error(
        "An entry assignment is no longer valid. Review the assignments again.",
      );
    const csv = buildSiteLineupCsv(
      template.site,
      [lineups[index]],
      salaryCatalog,
    );
    if (!csv.ok) throw new Error(csv.reason);
    const cells = parseDfsCsv(csv.lines[1])[0];
    if (
      template.eligibleIds.size &&
      cells.some(
        (cell) => !template.eligibleIds.has(cell.match(/\((\d+)\)$/)?.[1]),
      )
    ) {
      throw new Error(
        "A player ID is not in this template's eligible-player list. Check the slate and Captain slots.",
      );
    }
    cells.forEach((cell, i) => {
      rows[entry.rowIndex][template.start + i] = cell;
    });
    changed++;
  }
  if (!changed)
    throw new Error("Assign at least one lineup to an entry first.");
  return {
    lines: csvLines(rows),
    changed,
    filename: "draftkings-edit-entries",
  };
}
