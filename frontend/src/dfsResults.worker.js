import { inspectResultsCsv, parseResultsRows } from "./dfsResults.js";
import { DFS_RESULTS_COPY as C } from "./dfsToolPresentation.js";
import { readResultsFile } from "./dfsResultsFile.js";

let parsed;
self.onmessage = async ({ data: { action, file, mapping, options } }) => {
  try {
    if (action === "inspect") {
      parsed = null;
      const { text, filename } = await readResultsFile(file);
      parsed = inspectResultsCsv(text, { filename });
      // Keep the full CSV in the worker; the page only needs column metadata.
      self.postMessage({
        result: {
          headers: parsed.headers,
          mapping: parsed.mapping,
          rowCount: parsed.rows.length,
          contestId: parsed.contestId,
          isStandings: parsed.isStandings,
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
