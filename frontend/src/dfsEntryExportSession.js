/** Keep a validated local artifact independent of optional account history writes. */
const freeze = value => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export function isRetryableEntrySyncError(error) {
  return (error instanceof TypeError && /fetch|network|load failed|connection/i.test(error.message)) ||
    (Number.isInteger(error?.status) && error.status >= 500 && error.status <= 599);
}

/**
 * `artifact` must come from the validated entry serializer, never an imported
 * manifest. `authorize` performs a fresh authenticated API check; imported
 * IDs/hashes never grant access. Only transport/server failures allow recovery.
 * The caller supplies immutable, idempotent build versions to `synchronize`.
 */
export function createEntryExportSession({ artifact, authorize, synchronize }) {
  if (artifact?.manifest?.schema !== "scoresense_entry_export_v1" || typeof artifact.csv !== "string" ||
      typeof authorize !== "function" || typeof synchronize !== "function") {
    throw new Error("Validate the entry CSV and account before starting an export.");
  }
  const output = freeze(structuredClone(artifact));
  let syncStatus = "not_started", syncError = "", syncResult = null, downloaded = false;
  let syncInFlight = null, downloadInFlight = null;
  const snapshot = () => freeze({ artifact: output, syncStatus, syncError, syncResult, downloaded,
    lifecycle: "csv_created", acceptance: "unconfirmed" });
  const requireAuthorization = async () => {
    if (await authorize() !== true) {
      const error = new Error("Sign in to this account again before downloading or syncing entries.");
      error.status = 401;
      throw error;
    }
  };
  const sync = () => {
    if (syncStatus === "synced") return Promise.resolve(snapshot());
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
      syncStatus = "syncing";
      try {
        syncResult = freeze(structuredClone(await synchronize(output.manifest) ?? null));
        syncStatus = "synced"; syncError = "";
      } catch (error) {
        syncError = error.message || "History synchronization failed.";
        syncStatus = isRetryableEntrySyncError(error) ? "pending" : "blocked";
        if (syncStatus === "blocked") throw error;
      }
      return snapshot();
    })().finally(() => { syncInFlight = null; });
    return syncInFlight;
  };
  return {
    snapshot,
    retrySync: async () => { await requireAuthorization(); return sync(); },
    download: (download, { skipPendingSync = false } = {}) => {
      if (downloadInFlight) return downloadInFlight;
      downloadInFlight = (async () => {
        if (typeof download !== "function") throw new Error("Choose a CSV download destination first.");
        await requireAuthorization();
        if (!(skipPendingSync && syncStatus === "pending")) await sync();
        await download(output);
        downloaded = true;
        return snapshot();
      })().finally(() => { downloadInFlight = null; });
      return downloadInFlight;
    },
  };
}
