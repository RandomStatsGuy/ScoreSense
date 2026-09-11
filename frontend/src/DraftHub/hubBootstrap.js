/** Optional setup data must neither delay nor fail the current workspace. */
export function loadHubBootstrap({ loadWorkspace, loadPresets, onPresets, signal }) {
  const workspace = loadWorkspace();
  if (loadPresets) {
    Promise.resolve().then(loadPresets).then((presets) => {
      if (!signal?.aborted) onPresets(presets);
    }).catch(() => {
      // Keep existing presets on transient failure; workspace loading is independent.
    });
  }
  return workspace;
}
