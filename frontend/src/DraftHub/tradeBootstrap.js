/** Release the builder before starting optional inbox/insights work. */
export async function loadTradeBootstrap({ loadRosters, applyRosters, onReady, secondary, signal }) {
  const rosters = await loadRosters();
  if (signal?.aborted) return [];
  applyRosters(rosters);
  onReady();
  return Promise.allSettled(secondary.map(load => Promise.resolve().then(() => {
    if (!signal?.aborted) return load();
  })));
}
