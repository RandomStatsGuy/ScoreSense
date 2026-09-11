import { csvQuote } from "./table/csv.js";

/** RFC 4180 cells, including quoted commas, escaped quotes and newlines. IDs stay strings. */
export function parseDfsCsv(
  text,
  { maxChars = 5_000_000, maxRows = Infinity } = {},
) {
  const source = String(text).replace(/^\uFEFF/, "");
  if (source.length > maxChars)
    throw new Error(
      `This file is too large. Import up to ${maxChars / 1_000_000} MB at a time.`,
    );
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed)
        throw new Error(
          "A CSV quote is misplaced. Export the file as CSV again.",
        );
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      if (rows.length > maxRows)
        throw new Error(`Import up to ${maxRows - 1} entries at a time.`);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed && c.trim())
        throw new Error("Unexpected text after a CSV quote.");
      if (!closed) cell += c;
    }
  }
  if (quoted) throw new Error("The CSV ends inside a quoted cell.");
  if (cell || row.length || closed) {
    row.push(cell);
    rows.push(row);
    if (rows.length > maxRows)
      throw new Error(`Import up to ${maxRows - 1} entries at a time.`);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function csvLines(rows) {
  return rows.map((row) => row.map(csvQuote).join(","));
}
export function headerKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function moneyCents(value) {
  const s = String(value ?? "")
    .trim()
    .replace(/^\$/, "")
    .replaceAll(",", "");
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw new Error(
      `Invalid cash amount: ${value || "blank"}. Use dollars and cents.`,
    );
  const [dollars, cents = ""] = s.split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount))
    throw new Error("A cash amount is too large.");
  return amount;
}
