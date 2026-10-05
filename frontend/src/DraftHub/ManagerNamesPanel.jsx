import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { HubFilterMenu, HubLoadingSkeleton } from "./HubUILayout";
import { MANAGER_NAMES_COPY as COPY } from "./rulesPresentation";
import { invalidateInsightsAfterCapSync, invalidateLeagueRosterRequests, invalidateHomeCache, invalidateWeeklySnapshot } from "./hubDataCache";
import "./managerNames.css";

export default function ManagerNamesPanel({ leagueId, onDirtyChange }) {
  const [data, setData] = useState(null);
  const [source, setSource] = useState("");
  const [custom, setCustom] = useState("");
  const [account, setAccount] = useState("");
  const [year, setYear] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const currentLeague = useRef(leagueId);
  currentLeague.current = leagueId;
  const dirty = Boolean(source || custom || account || year);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const discard = () => { setSource(""); setCustom(""); setAccount(""); setYear(0); };
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(""); setStatus(""); discard();
    apiFetch(`/api/hub/league/${leagueId}/manager-accounts`, { signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error(await parseApiError(res)); return res.json(); })
      .then((next) => { if (!controller.signal.aborted) setData(next); })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message || COPY.loadError); });
    return () => controller.abort();
  }, [leagueId, reload]);
  const invalidate = () => {
    invalidateInsightsAfterCapSync(leagueId); invalidateLeagueRosterRequests(leagueId);
    invalidateHomeCache(leagueId); invalidateWeeklySnapshot(leagueId);
  };
  const change = async (mapId) => {
    const boundLeague = leagueId;
    setBusy(true); setError(""); setStatus("");
    const selected = data.sources.find((_, i) => String(i) === source);
    try {
      const res = await apiFetch(`/api/hub/league/${boundLeague}/manager-accounts${mapId ? `/${mapId}` : ""}`, {
        method: mapId ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        ...(!mapId ? { body: JSON.stringify({ source_kind: selected?.source_kind || "owner_label",
          source_key: selected?.source_key || custom.trim(), account_sub: account, season_year: Number(year) }) } : {}),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      invalidate();
      if (currentLeague.current !== boundLeague) return;
      const refresh = await apiFetch(`/api/hub/league/${boundLeague}/manager-accounts`);
      if (!refresh.ok) throw new Error(await parseApiError(refresh));
      const next = await refresh.json();
      if (currentLeague.current !== boundLeague) return;
      setData(next); if (!mapId) discard();
      setStatus(mapId ? COPY.removed : COPY.saved);
    } catch (err) {
      if (currentLeague.current === boundLeague) setError(err.message || (mapId ? COPY.removeError : COPY.saveError));
    } finally {
      if (currentLeague.current === boundLeague) setBusy(false);
    }
  };
  const sources = [{ id: "", label: COPY.sourcePlaceholder }, ...(data?.sources || []).map((r, i) => ({
    id: String(i), label: `${r.label} · ${r.source_kind === "sleeper_user_id" ? COPY.sleeper : COPY.imported}`,
  })), { id: "custom", label: COPY.custom }];
  const years = [...new Set((data?.sources || []).flatMap((r) => r.seasons))].sort((a,b) => b-a);
  const ready = source !== "" && (source !== "custom" || custom.trim()) && account;
  return <section className="hub-rules-section hub-manager-names" aria-labelledby="manager-names-title">
    <header className="hub-rules-section-head"><div><h3 id="manager-names-title">{COPY.title}</h3><p>{COPY.help}</p></div></header>
    {error && <div role="alert" className="error-banner"><p>{error}</p>{!data && <button className="btn-ghost btn-sm" type="button" onClick={() => setReload((n) => n+1)}>{COPY.retry}</button>}</div>}
    {!data && !error && <HubLoadingSkeleton label={COPY.loading} rows={3} />}
    {data && <>
      <p className="chart-note">{COPY.effect}</p>
      {data.accounts.length ? <>
        <div className="hub-rules-field-grid">
          <HubFilterMenu label={COPY.source} value={source} options={sources} onChange={setSource} disabled={busy} ariaLabel={COPY.source} />
          {source === "custom" && <label><span>{COPY.customLabel}</span><input type="text" maxLength={120} value={custom} disabled={busy} onChange={(e) => setCustom(e.target.value)} /></label>}
          <HubFilterMenu label={COPY.account} value={account} options={[{ id: "", label: COPY.accountPlaceholder }, ...data.accounts.map((a) => ({ id: a.account_sub, label: a.display_name, detail: a.team_name }))]} onChange={setAccount} disabled={busy} ariaLabel={COPY.account} />
          <HubFilterMenu label={COPY.period} value={year} options={[{ id: 0, label: COPY.all }, ...years.map((y) => ({ id: y, label: String(y) }))]} onChange={setYear} disabled={busy} ariaLabel={COPY.period} />
        </div>
        <div className="hub-manager-name-actions">
          <button type="button" className="btn-ghost btn-sm" disabled={!dirty || busy} onClick={discard}>{COPY.discard}</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ready || busy} onClick={() => change()}>{busy ? COPY.saving : COPY.save}</button>
        </div>
      </> : <div className="hub-empty-state"><p>{COPY.noAccounts}</p></div>}
      <p className="chart-note">{COPY.accountHelp}</p>
      <h4>{COPY.savedTitle}</h4>
      {data.mappings.length ? <ul className="hub-manager-name-links">{data.mappings.map((r) => <li key={r.id}>
        <div><strong>{r.source_label} → {r.display_name || COPY.missingAccount}</strong><small>{r.season_year || COPY.all} · {r.source_kind === "sleeper_user_id" ? COPY.sleeper : COPY.imported}</small></div>
        <button type="button" className="btn-ghost btn-sm" disabled={busy} aria-label={`${COPY.remove} ${r.source_label}`} onClick={() => change(r.id)}>{COPY.remove}</button>
      </li>)}</ul> : <div className="hub-empty-state"><p>{COPY.empty}</p></div>}
    </>}
    {status && <p role="status">{status}</p>}
  </section>;
}
