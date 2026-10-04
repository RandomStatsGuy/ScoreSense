import React, { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../../format";
import { periodLabel, periodYears } from "./insightsPeriods";
import { INSIGHTS_COPY } from "./insightsPresentation";
import { InsightsProgress } from "./InsightsChrome";

export default function InsightsHeader({ tabs, active, onTab, landing, years, period, onPeriod, onRefresh, busy, showPeriod = true }) {
  const details = useRef(null);
  const choices = [...new Set((years || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const first = choices[0] || new Date().getFullYear();
  const last = choices.at(-1) || first;
  const [from, setFrom] = useState(first);
  const [through, setThrough] = useState(last);
  useEffect(() => { setFrom(first); setThrough(last); }, [first, last]);
  useEffect(() => { if (details.current) details.current.open = false; }, [active]);
  useEffect(() => {
    const dismiss = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && details.current?.contains(event.target)) return;
      if (details.current?.open) {
        details.current.open = false;
        if (event.type === "keydown") details.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismiss); };
  }, []);
  const choose = (next) => { onPeriod(next); if (details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); } };
  const selected = periodYears(choices, period);
  const range = selected.length ? `${selected[0]}–${selected.at(-1)} · ${selected.length} ${selected.length === 1 ? "season" : "seasons"}` : "No saved seasons";
  return <header className="hub-insights-header">
    <div className="hub-insights-title">
      <span className="hub-experience-eyebrow">{INSIGHTS_COPY.overview.eyebrow}</span>
      <h1>{INSIGHTS_COPY.overview.heading}</h1>
      <p className="table-meta">{landing?.available ? `${range} · ${landing.record_leaders?.length || 0} managers` : "Saved league history"}</p>
    </div>
    <div className="hub-insights-header-tabs">
      <nav className="hub-insights-tabs" aria-label="Insights">{tabs.map((tab) => <button key={tab.id} type="button" aria-current={active === tab.id ? "true" : undefined} onClick={() => onTab(tab.id)}>{tab.label}</button>)}</nav>
      <InsightsProgress active={busy} />
    </div>
    {showPeriod && <div className="hub-insights-period-toolbar">
      <details className="hub-insights-period" ref={details}>
        <summary aria-label={`Period: ${periodLabel(period)}`}><span>Period</span><strong>{periodLabel(period)}</strong><span aria-hidden="true">⌄</span></summary>
        <div className="hub-insights-period-menu">
          <div className="hub-insights-period-presets">
            <button type="button" className="btn-ghost" aria-pressed={period.mode === "all"} onClick={() => choose({ mode: "all" })}>All time</button>
            <button type="button" className="btn-ghost" disabled={!choices.length} aria-pressed={period.mode === "last3"} onClick={() => choose({ mode: "last3" })}>Last 3 years</button>
          </div>
          <div className="hub-insights-period-years" aria-label="Season">
            {choices.map((year) => <button type="button" className="btn-ghost" key={year} aria-pressed={period.mode === "range" && period.from === year && period.through === year} onClick={() => choose({ mode: "range", from: year, through: year })}>{year}</button>)}
          </div>
          {choices.length > 1 && <>
            <div className="hub-insights-range-fields">
              <label>From <output>{from}</output><input aria-label="From year" type="range" min={first} max={last} value={from} onChange={(e) => setFrom(Math.min(Number(e.target.value), through))} /></label>
              <label>Through <output>{through}</output><input aria-label="Through year" type="range" min={first} max={last} value={through} onChange={(e) => setThrough(Math.max(Number(e.target.value), from))} /></label>
            </div>
            <button type="button" className="btn-ghost" onClick={() => choose({ mode: "range", from, through })}>Apply range</button>
          </>}
        </div>
      </details>
      <span className="table-meta hub-insights-period-context">{range}</span>
    </div>}
    <div className="hub-insights-header-freshness">
      <span className="table-meta" role="status">{landing?.synced_at ? formatRelativeTime(landing.synced_at) : "Saved history"}</span>
      <button type="button" className="btn-ghost hub-insights-refresh" aria-label={INSIGHTS_COPY.overview.refresh} title={INSIGHTS_COPY.overview.refresh} onClick={onRefresh} disabled={busy}>
        <span className="hub-insights-refresh-label">{busy ? INSIGHTS_COPY.overview.refreshing : INSIGHTS_COPY.overview.refresh}</span>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 11.7-1L20 9M4 15l2.8 3a7 7 0 0 0 11.7-1" /></svg>
      </button>
    </div>
  </header>;
}
