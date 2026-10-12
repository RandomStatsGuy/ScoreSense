import { readPortfolioBackup, writePortfolioBackup } from "./dfsPortfolioBackup.js";
import { DFS_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";

globalThis.onmessage = event => {
  try {
    const request = event.data;
    const value = request?.operation === "write"
      ? writePortfolioBackup(request.batches, request.limits, request.exportedAt, request.options)
      : request?.operation === "read" ? readPortfolioBackup(request.json) : (() => { throw new Error(C.backupInvalid); })();
    globalThis.postMessage({ ok: true, value });
  } catch (error) { globalThis.postMessage({ ok: false, error: error.message || C.backupInvalid }); }
};
