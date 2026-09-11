import { unzipSync, strFromU8 } from "fflate";
import { contestIdFromFilename } from "./dfsResults.js";
import { DFS_RESULTS_COPY as C } from "./dfsToolPresentation.js";

export async function readResultsFile(file) {
  if (file.size > 100_000_000) throw new Error(C.fileLimit);
  if (!/\.zip$/i.test(file.name))
    return { text: await file.text(), filename: file.name };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const candidates = [];
  try {
    // Inspect first, so multiple CSVs or oversized members are never inflated.
    unzipSync(bytes, {
      filter: (entry) => {
        if (/\.csv$/i.test(entry.name) && !entry.name.startsWith("__MACOSX/"))
          candidates.push(entry);
        return false;
      },
    });
  } catch {
    throw new Error(C.invalidZip);
  }
  if (candidates.length !== 1) throw new Error(C.zipCsvCount);
  const selected = candidates[0];
  if (selected.originalSize > 100_000_000) throw new Error(C.fileLimit);
  const outerId = contestIdFromFilename(file.name);
  const innerId = contestIdFromFilename(selected.name);
  if (outerId && innerId && outerId !== innerId)
    throw new Error(C.zipContestMismatch);
  let contents;
  try {
    contents = unzipSync(bytes, {
      filter: (entry) => entry.name === selected.name,
    })[selected.name];
  } catch {
    throw new Error(C.invalidZip);
  }
  if (!contents || contents.length !== selected.originalSize)
    throw new Error(C.invalidZip);
  return {
    text: strFromU8(contents),
    filename: innerId ? selected.name : file.name,
  };
}
