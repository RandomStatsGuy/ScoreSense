import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import {
  getFreshnessCache,
  invalidateFreshnessCache,
  invalidateInsightsAfterCapSync,
  setFreshnessCache,
} from "./hubDataCache";

function FreshnessChip({ label, at, stale, missing }) {
  let value = "—";
  if (at) value = formatRelativeTime(at);
  else if (missing) value = "Not linked";
  const tone = stale ? "stale" : at ? "ok" : "muted";
  const toneLabel = stale ? "stale" : at ? "up to date" : missing ? "not linked" : "no data";
  return (
    <span
      className={`hub-freshness-chip hub-freshness-chip-${tone}`}
      title={at ? `${label}: ${toneLabel} (${at})` : `${label}: ${toneLabel}`}
    >
      <span className="hub-freshness-dot" aria-hidden="true" />
      <span className="hub-freshness-chip-label">{label}</span>
      <span className="hub-freshness-chip-value">{value}</span>
    </span>
  );
}

export default function HubDataFreshness({
  leagueId,
  hubContext,
  leagueSyncing = false,
}) {
  const isDemo = Boolean(hubContext?.demo);
  const [data, setData] = useState(() => getFreshnessCache(leagueId)?.data || null);
  const [loading, setLoading] = useState(false);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [error, setError] = useState("");

  const isCommissioner = Boolean(hubContext?.is_commissioner);

  const load = useCallback(async (signal) => {
    if (!leagueId) return;
    const cached = getFreshnessCache(leagueId);
    if (cached?.data) setData(cached.data);
    setLoading(!cached?.data);
    setError("");
    try {
      const root = isDemo ? "/api/hub/demo" : "/api/hub";
      const res = await apiFetch(
        `${root}/league/${encodeURIComponent(leagueId)}/freshness`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setFreshnessCache(leagueId, payload);
      setData(payload);
    } catch (e) {
      if (signal?.aborted) return;
      setError(connectionErrorMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [leagueId, isDemo]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const runSheetSync = useCallback(async () => {
    if (!leagueId) return;
    setSheetSyncing(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/contract-history/sync`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      invalidateInsightsAfterCapSync(leagueId);
      invalidateFreshnessCache(leagueId);
      await load(undefined);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSheetSyncing(false);
    }
  }, [leagueId, load, isDemo]);

  if (!leagueId || hubContext?.mode !== "league") return null;

  const capStale = Boolean(data?.cap_sheets?.stale);
  const poolStale = Boolean(data?.projections?.stale);

  return (
    <section className="hub-freshness" role="status" aria-busy={loading || leagueSyncing || sheetSyncing}>
      <div className="hub-freshness-chips">
        <FreshnessChip
          label="Sleeper"
          at={data?.sleeper?.synced_at}
          missing={data && !data.sleeper?.linked}
        />
        <FreshnessChip
          label="Scoring"
          at={data?.scoring?.synced_at}
          missing={data && !data.scoring?.linked}
        />
        <FreshnessChip
          label="Cap sheets"
          at={data?.cap_sheets?.last_imported_at}
          stale={capStale}
        />
        <FreshnessChip
          label="Projections"
          at={data?.projections?.built_at}
          stale={poolStale}
          missing={data && !data.projections?.available}
        />
      </div>
      {isCommissioner && !isDemo && (
        <div className="hub-freshness-actions">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={runSheetSync}
            disabled={leagueSyncing || sheetSyncing}
            title="Re-import cap sheets and contract history"
          >
            {sheetSyncing ? "Syncing…" : "Sync sheets"}
          </button>
        </div>
      )}
      {error && <p className="chart-note hub-freshness-error">{error}</p>}
    </section>
  );
}
