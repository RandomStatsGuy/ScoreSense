import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, PRODUCT_DISCLAIMER } from "./auth";
import { connectionErrorMessage, fmtNum, parseApiError } from "./format";
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";

const POSITIONS = [
  { id: "qb", label: "QB" },
  { id: "rb", label: "RB" },
  { id: "wr", label: "WR/TE" },
];

const REC_LABELS = {
  lean_over: "Lean over",
  lean_under: "Lean under",
  pass: "Pass",
  model_only: "Model only",
};

export default function PropScan({ projMeta, loading: parentLoading }) {
  const [localMeta, setLocalMeta] = useState(null);
  const activeMeta = projMeta || localMeta;
  const [position, setPosition] = useState("qb");
  const [season, setSeason] = useState(null);
  const [week, setWeek] = useState(null);
  const [props, setProps] = useState([]);
  const [note, setNote] = useState("");
  const [useOdds, setUseOdds] = useState(true);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [propFilter, setPropFilter] = useState("ALL");
  const fileInputRef = useRef(null);

  const weekOptions = useMemo(() => {
    if (!activeMeta || season == null) return [];
    return activeMeta.weeks_by_season?.[String(season)] || [];
  }, [activeMeta, season]);

  useEffect(() => {
    if (projMeta) return;
    (async () => {
      try {
        const res = await apiFetch("/api/meta/projections/qb");
        if (res.ok) setLocalMeta(await res.json());
      } catch {
        /* optional */
      }
    })();
  }, [projMeta]);

  useEffect(() => {
    if (!activeMeta) return;
    setSeason((prev) => prev ?? activeMeta.default_season);
    setWeek((prev) => prev ?? activeMeta.default_week);
  }, [activeMeta]);

  const fetchScan = useCallback(async () => {
    if (season == null || week == null) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/props/scan?position=${position}&season=${season}&week=${week}&use_odds=${useOdds}`
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load prop scan"));
      const data = await res.json();
      setProps(data.props || []);
      setMeta(data.meta || null);
      setNote(data.note || "");
    } catch (err) {
      setProps([]);
      setError(connectionErrorMessage(err, "Failed to load props"));
    } finally {
      setLoading(false);
    }
  }, [position, season, week, useOdds]);

  useEffect(() => {
    fetchScan();
  }, [fetchScan]);

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || season == null || week == null) return;
    setImporting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(
        `/api/props/lines/import?position=${position}&season=${season}&week=${week}`,
        { method: "POST", body: form }
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Import failed"));
      const data = await res.json();
      setProps(data.props || []);
      setMeta(data.meta || null);
      setNote(data.note || "");
    } catch (err) {
      setError(connectionErrorMessage(err, "Import failed"));
    } finally {
      setImporting(false);
    }
  };

  const propTypes = useMemo(() => {
    const types = new Set(props.map((p) => p.prop_type).filter(Boolean));
    return ["ALL", ...Array.from(types).sort()];
  }, [props]);

  const filtered = props.filter((p) => propFilter === "ALL" || p.prop_type === propFilter);
  const busy = loading || parentLoading;
  const mobileLayout = useMobileLayout();

  return (
    <section className="panel wide">
      <div className="lineup-header">
        <div>
          <h2>Prop scan</h2>
          <p className="chart-note">
            Fair lines from projections vs market (Odds API or CSV).
          </p>
          <p className="chart-note product-disclaimer">{PRODUCT_DISCLAIMER}</p>
        </div>
        <div className="lineup-controls">
          <div className="lineup-pos-tabs">
            {POSITIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`tab lineup-pos-tab ${position === p.id ? "active" : ""}`}
                onClick={() => setPosition(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {activeMeta && season != null && (
            <div className="lineup-controls-time">
              <label className="control-label">
                Season
                <select className="control-select" value={season} onChange={(e) => setSeason(Number(e.target.value))}>
                  {(activeMeta.seasons || []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="control-label">
                Week
                <select className="control-select" value={week ?? ""} onChange={(e) => setWeek(Number(e.target.value))}>
                  {weekOptions.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label className="control-label lineup-check">
            <input
              type="checkbox"
              checked={useOdds}
              onChange={(e) => setUseOdds(e.target.checked)}
            />
            Load market lines (Odds API)
          </label>
          <input ref={fileInputRef} type="file" accept=".csv" className="lineup-file-input" onChange={handleImport} />
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? "Importing…" : "Import CSV fallback"}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {note && <p className="chart-note">{note}</p>}
      {meta?.with_market != null && (
        <p className="chart-note">
          Market lines matched: {meta.with_market}
          {meta.odds?.error ? ` · Odds API: ${meta.odds.error}` : ""}
        </p>
      )}

      <div className="lineup-pos-tabs" style={{ marginBottom: "0.75rem" }}>
        {propTypes.map((t) => (
          <button
            key={t}
            type="button"
            className={`tab lineup-pos-tab ${propFilter === t ? "active" : ""}`}
            onClick={() => setPropFilter(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {mobileLayout ? (
        <MobileDataList
          loading={busy && filtered.length === 0}
          emptyMessage={!busy && filtered.length === 0 ? "No props for this filter." : null}
        >
          {filtered.slice(0, 200).map((row, idx) => {
            const edge = row.edge != null && !Number.isNaN(row.edge) ? fmtNum(row.edge) : "—";
            const signal = REC_LABELS[row.recommendation] || row.recommendation || "—";
            return (
              <MobilePlayerCard
                key={`${row.player_id}-${row.prop_type}-${idx}`}
                name={row.player}
                meta={row.prop_type}
                heroValue={row.market_line != null ? fmtNum(row.market_line) : fmtNum(row.model_fair)}
                heroLabel={row.market_line != null ? "market" : "model"}
                badge={(
                  <span className={`prop-signal prop-signal-${row.recommendation || "model_only"}`}>
                    {signal}
                  </span>
                )}
                expanded={(
                  <div className="mobile-stat-grid">
                    <MobileStat label="Model fair" value={fmtNum(row.model_fair)} />
                    <MobileStat label="Market" value={row.market_line != null ? fmtNum(row.market_line) : "—"} />
                    <MobileStat
                      label="Edge"
                      value={edge}
                      className={row.edge > 0 ? "edge-positive" : row.edge < 0 ? "edge-negative" : ""}
                    />
                  </div>
                )}
              />
            );
          })}
        </MobileDataList>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Prop</th>
              <th className="num">Model fair</th>
              <th className="num">Market</th>
              <th className="num">Edge</th>
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {busy && filtered.length === 0 && (
              <tr><td colSpan={6} className="muted">Loading…</td></tr>
            )}
            {!busy && filtered.length === 0 && (
              <tr><td colSpan={6} className="muted">No props for this filter.</td></tr>
            )}
            {filtered.slice(0, 200).map((row, idx) => (
              <tr key={`${row.player_id}-${row.prop_type}-${idx}`}>
                <td>{row.player}</td>
                <td>{row.prop_type}</td>
                <td className="num">{fmtNum(row.model_fair)}</td>
                <td className="num">{row.market_line != null ? fmtNum(row.market_line) : "—"}</td>
                <td className={`num ${row.edge > 0 ? "edge-positive" : row.edge < 0 ? "edge-negative" : ""}`}>
                  {row.edge != null && !Number.isNaN(row.edge) ? fmtNum(row.edge) : "—"}
                </td>
                <td>
                  <span className={`prop-signal prop-signal-${row.recommendation || "model_only"}`}>
                    {REC_LABELS[row.recommendation] || row.recommendation || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}
