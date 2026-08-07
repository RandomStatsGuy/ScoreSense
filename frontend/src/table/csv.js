/** CSV download helpers shared by projection tables. */

export function csvQuote(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function downloadCsv(filenamePrefix, lines) {
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
