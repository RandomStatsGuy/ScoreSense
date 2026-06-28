import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, PRODUCT_DISCLAIMER } from "./auth";
import { connectionErrorMessage, fmtNum, parseApiError } from "./format";
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";

export default function BestBallBoard({ draftMeta, loading: parentLoading }) {
  const [localMeta, setLocalMeta] = useState(null);
  const activeMeta = draftMeta || localMeta;
  const [season, setSeason] = useState(null);
  const [players, setPlayers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");

  useEffect(() => {
    if (draftMeta) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/meta/draft/qb");
        if (!cancelled && res.ok) setLocalMeta(await res.json());
      } catch {
        /* optional */
      }
    })();
    return () => { cancelled = true; };
  }, [draftMeta]);

  useEffect(() => {
    if (!activeMeta) return;
    setSeason((prev) => prev ?? activeMeta.default_season);
  }, [activeMeta]);

  const fetchBoard = useCallback(async () => {
    if (season == null) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/bestball/board?season=${season}`);
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load best ball board"));
      const data = await res.json();
      setPlayers(data.players || []);
      setMeta(data.meta || null);
    } catch (err) {
      setPlayers([]);
      setError(connectionErrorMessage(err, "Failed to load board"));
    } finally {
      setLoading(false);
    }
  }, [season]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const filtered = players.filter((p) => posFilter === "ALL" || p.Position === posFilter);
  const busy = loading || parentLoading;
  const mobileLayout = useMobileLayout();

  return (
    <section className="panel wide">
      <div className="lineup-header">
        <div>
          <h2>Best ball board</h2>
          <p className="chart-note product-disclaimer">{PRODUCT_DISCLAIMER}</p>
        </div>
        {activeMeta && season != null && (
          <label className="control-label">
            Draft season
            <select
              className="control-select"
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
            >
              {(activeMeta.seasons || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {meta && (
        <p className="table-meta">
          {meta.count} players · ADP on {meta.with_adp ?? 0} rows
          {meta.adp_source ? ` · ${meta.adp_source}` : ""}
        </p>
      )}

      <div className="lineup-pos-tabs" style={{ marginBottom: "0.75rem" }}>
        {["ALL", "QB", "RB", "WR/TE"].map((p) => (
          <button
            key={p}
            type="button"
            className={`tab lineup-pos-tab ${posFilter === p ? "active" : ""}`}
            onClick={() => setPosFilter(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {mobileLayout ? (
        <MobileDataList
          loading={busy && filtered.length === 0}
          emptyMessage={!busy && filtered.length === 0 ? "No players found." : null}
        >
          {filtered.map((row) => {
            const valueVsAdp = row.value_vs_adp != null && !Number.isNaN(row.value_vs_adp)
              ? `${row.value_vs_adp > 0 ? "+" : ""}${fmtNum(row.value_vs_adp, 1)}`
              : "—";
            return (
              <MobilePlayerCard
                key={`${row.player_id}-${row.Player}`}
                name={row.Player}
                meta={[row.Position, row.Team].filter(Boolean).join(" · ") || "—"}
                heroValue={row.adp_rank != null ? fmtNum(row.adp_rank, 0) : fmtNum(row["Season Proj"])}
                heroLabel={row.adp_rank != null ? "ADP" : "proj"}
                expanded={(
                  <div className="mobile-stat-grid">
                    <MobileStat label="Season proj" value={fmtNum(row["Season Proj"])} />
                    <MobileStat
                      label="Model rank"
                      value={row.model_rank != null ? Math.round(row.model_rank) : "—"}
                    />
                    <MobileStat label="ADP" value={row.adp_rank != null ? fmtNum(row.adp_rank, 0) : "—"} />
                    <MobileStat
                      label="Value vs ADP"
                      value={valueVsAdp}
                      className={row.value_vs_adp > 0 ? "edge-positive" : ""}
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
              <th>Pos</th>
              <th>Team</th>
              <th className="num">Season Proj</th>
              <th className="num">Model rank</th>
              <th className="num">ADP</th>
              <th className="num">Value vs ADP</th>
            </tr>
          </thead>
          <tbody>
            {busy && filtered.length === 0 && (
              <tr><td colSpan={7} className="muted">Loading board…</td></tr>
            )}
            {!busy && filtered.length === 0 && (
              <tr><td colSpan={7} className="muted">No players found.</td></tr>
            )}
            {filtered.map((row) => (
              <tr key={`${row.player_id}-${row.Player}`}>
                <td>{row.Player}</td>
                <td>{row.Position}</td>
                <td>{row.Team || "—"}</td>
                <td className="num">{fmtNum(row["Season Proj"])}</td>
                <td className="num">{row.model_rank != null ? Math.round(row.model_rank) : "—"}</td>
                <td className="num">{row.adp_rank != null ? fmtNum(row.adp_rank, 0) : "—"}</td>
                <td className={`num ${row.value_vs_adp > 0 ? "edge-positive" : ""}`}>
                  {row.value_vs_adp != null && !Number.isNaN(row.value_vs_adp)
                    ? (row.value_vs_adp > 0 ? "+" : "") + fmtNum(row.value_vs_adp, 1)
                    : "—"}
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
