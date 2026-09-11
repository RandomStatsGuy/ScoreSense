import { DFS_RESULTS_COPY as C } from "./dfsToolPresentation.js";

export async function importResultsBatches(
  entries,
  request,
  onProgress = () => {},
) {
  let saved = 0;
  onProgress(saved, entries.length);
  try {
    for (let offset = 0; offset < entries.length; offset += 1000) {
      const batch = entries.slice(offset, offset + 1000);
      await request("/api/lineup/results/import?compact=true", {
        method: "POST",
        body: JSON.stringify({ entries: batch }),
      });
      saved += batch.length;
      onProgress(saved, entries.length);
    }
  } catch (error) {
    throw new Error(C.importInterrupted(saved, entries.length, error.message));
  }
  return saved;
}
