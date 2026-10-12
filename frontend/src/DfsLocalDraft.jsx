import React, { useEffect, useMemo, useRef, useState } from "react";
import { getToken } from "./auth.js";
import { createLocalDraftStore, localDraftScope } from "./dfsLocalDraft.js";
import { writePortfolioBackupAsync, readPortfolioBackupAsync } from "./dfsPortfolioBackupAsync.js";
import { createPortfolioBatch, auditPortfolio } from "./dfsPortfolio.js";
import { confirmDialog } from "./ui/confirm.jsx";
import { DFS_GLOBAL_COPY as C, DFS_PORTFOLIO_COPY as P } from "./dfsToolPresentation.js";

export default function DfsLocalDraft({ b }) {
  const store = useMemo(() => createLocalDraftStore(), []);
  const [scope, setScope] = useState(() => localDraftScope(getToken()));
  const [status, setStatus] = useState("loading"), [available, setAvailable] = useState(false);
  const [working, setWorking] = useState(false);
  const queue = useRef(Promise.resolve()), version = useRef(0);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(() => {
    const change = () => { version.current++; setScope(localDraftScope(getToken())); };
    window.addEventListener("scoresense-auth-changed", change);
    return () => window.removeEventListener("scoresense-auth-changed", change);
  }, []);
  useEffect(() => {
    let current = true;
    store.read(scope).then(json => { if (current) { setAvailable(Boolean(json)); setStatus(json ? "available" : "empty"); } })
      .catch(() => { if (current) setStatus("error"); });
    return () => { current = false; };
  }, [scope, store]);
  useEffect(() => {
    if (!b.portfolio.length && !b.currentBuild) return;
    const epoch = ++version.current;
    const timer = setTimeout(() => {
      if (epoch !== version.current) return;
      setStatus("saving");
      queue.current = queue.current.catch(() => {}).then(async () => {
        if (epoch !== version.current) return;
        const batches = b.portfolio.length ? b.portfolio : [createPortfolioBatch(b.currentBuild, "Current build", "local-current-build")];
        const json = await writePortfolioBackupAsync(batches, b.portfolioLimits, undefined, { reviewRules: b.portfolioRules });
        if (epoch !== version.current) return;
        await store.write(scope, json);
        if (epoch === version.current) { setStatus("saved"); setAvailable(true); }
      }).catch(() => { if (epoch === version.current) setStatus("error"); });
    }, 400);
    return () => clearTimeout(timer);
  }, [b.portfolio, b.portfolioLimits, b.portfolioRules, b.currentBuild, scope, store]);
  const restore = async () => {
    setWorking(true);
    const epoch = version.current, restoreScope = scope;
    const requireCurrent = () => { if (epoch !== version.current || restoreScope !== activeScope.current) throw new Error(C.localRestoreChanged); };
    try {
      await queue.current;
      requireCurrent();
      const backup = await readPortfolioBackupAsync(await store.read(scope));
      requireCurrent();
      if (b.portfolio.length && !await confirmDialog({ title: P.replaceTitle, message: P.replaceMessage(b.portfolio.length, auditPortfolio(backup.batches, backup.appearanceLimits, backup.reviewRules)), confirmLabel: P.replace, cancelLabel: P.cancelRestore, danger: true })) return;
      requireCurrent();
      b.replacePortfolio(backup);
    } catch (error) { b.setError(error.message); }
    finally { setWorking(false); }
  };
  return <section className="dfw-panel dfw-local-draft" aria-label={C.localTitle}>
    <h3>{C.localTitle}</h3><p role="status" className="dfw-note">{({ saved: C.localSaved, saving: C.localSaving, available: C.localAvailable, empty: C.localEmpty, error: C.localError })[status] || C.localSaving}</p>
    <p className="dfw-note">{C.localHelp}</p><div className="dfw-actions">
      <button type="button" disabled={!available || working || b.building} onClick={restore}>{C.localRestore}</button>
      <button type="button" disabled={!available || working || b.building} onClick={async () => {
        setWorking(true); const epoch = ++version.current, deleteScope = scope;
        try { await queue.current; await store.remove(deleteScope); if (epoch === version.current && deleteScope === activeScope.current) { setAvailable(false); setStatus("empty"); } }
        catch (error) { if (epoch === version.current && deleteScope === activeScope.current) b.setError(error.message); }
        finally { setWorking(false); }
      }}>{C.localDiscard}</button>
    </div>
  </section>;
}
