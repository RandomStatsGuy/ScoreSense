import { PORTFOLIO_BACKUP_MAX_BYTES, readPortfolioBackup, writePortfolioBackup } from "./dfsPortfolioBackup.js";
import { DFS_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";

// postMessage removes frozen property descriptors. Restore them in place without
// cloning the returned snapshot graph a second time on the main thread.
function freezeTransferred(value) {
  const seen = new WeakSet();
  const visit = item => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item); Object.values(item).forEach(visit); Object.freeze(item);
  };
  visit(value); return value;
}

function requestBackup(operation, payload) {
  if (typeof Worker === "undefined") {
    // Pure helpers remain the fallback in Node and other workerless runtimes.
    return Promise.resolve().then(() => operation === "write"
      ? writePortfolioBackup(payload.batches, payload.limits, payload.exportedAt, payload.options)
      : readPortfolioBackup(payload.json));
  }
  return new Promise((resolve, reject) => {
    let worker;
    const finish = (error, result) => {
      if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
      if (error) reject(error); else resolve(result);
    };
    try {
      worker = new Worker(new URL("./dfsPortfolioBackup.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = event => {
        const response = event.data;
        if (response?.ok === true && Object.hasOwn(response, "value")) finish(null, response.value);
        else finish(new Error(typeof response?.error === "string" ? response.error : C.backupInvalid));
      };
      worker.onerror = event => { event.preventDefault?.(); finish(new Error(event.message || C.backupInvalid)); };
      worker.onmessageerror = () => finish(new Error(C.backupInvalid));
      worker.postMessage({ operation, ...payload });
    } catch (error) { finish(error); }
  });
}

export async function writePortfolioBackupAsync(batches, limits = {}, exportedAt = undefined, options = {}) {
  return requestBackup("write", { batches, limits, exportedAt, options });
}

export async function readPortfolioBackupAsync(json) {
  if (typeof json !== "string" || new TextEncoder().encode(json).length > PORTFOLIO_BACKUP_MAX_BYTES) throw new Error(C.backupSize);
  return freezeTransferred(await requestBackup("read", { json }));
}

export async function readPortfolioBackupFileAsync(file) {
  if (file.size > PORTFOLIO_BACKUP_MAX_BYTES) throw new Error(C.backupSize);
  return readPortfolioBackupAsync(await file.text());
}

export async function downloadPortfolioBackupAsync(batches, limits, reviewRules, { beforeDownload } = {}) {
  const json = await writePortfolioBackupAsync(batches, limits, undefined, { reviewRules });
  beforeDownload?.();
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  try {
    const link = document.createElement("a");
    link.href = url; link.download = `scoresense-classic-portfolio-${Date.now()}.json`; link.click();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
