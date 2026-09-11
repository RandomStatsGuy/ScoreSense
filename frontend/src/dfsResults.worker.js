import { inspectResultsCsv, parseResultsRows } from "./dfsResults.js";
import { DFS_RESULTS_COPY as C } from "./dfsToolPresentation.js";

let parsed;
self.onmessage = async ({ data: { action, file, mapping, options } }) => {
  try {
    if (action === "inspect") {
      parsed = null;
      if (file.size > 100_000_000) throw new Error(C.fileLimit);
      parsed = inspectResultsCsv(await file.text());
      // Keep the full CSV in the worker; the page only needs column metadata.
      self.postMessage({
        result: {
          headers: parsed.headers,
          mapping: parsed.mapping,
          rowCount: parsed.rows.length,
        },
      });
    } else if (action === "preview") {
      if (!parsed) throw new Error(C.chooseFile);
      self.postMessage({ result: parseResultsRows(parsed, mapping, options) });
    }
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
