/** Local data only; this scope never authorizes a server read or write. */
export function localDraftScope(token) {
  if (!token) return "browser-local";
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part));
    if (typeof claims.sub === "string" && claims.sub.length <= 100) return `account:${claims.sub}`;
  } catch { /* An invalid credential must not select another account's draft. */ }
  return "unavailable";
}

export function createLocalDraftStore(indexedDB = globalThis.indexedDB) {
  const transact = async (scope, mode, action) => {
    if (!indexedDB || scope === "unavailable") throw new Error("Local draft storage unavailable.");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("scoresense-dfs-local", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("drafts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("drafts", mode), request = action(tx.objectStore("drafts"), scope);
        tx.oncomplete = () => resolve(request.result ?? null);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Local draft interrupted."));
      });
    } finally { db.close(); }
  };
  return {
    read: scope => transact(scope, "readonly", (store, key) => store.get(key)),
    write: (scope, json) => transact(scope, "readwrite", (store, key) => store.put(json, key)),
    remove: scope => transact(scope, "readwrite", (store, key) => store.delete(key)),
  };
}
