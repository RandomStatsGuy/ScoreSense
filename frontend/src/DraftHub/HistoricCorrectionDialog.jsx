import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { fmtSal } from "./rosterFormat";
import {
  CORRECTION_MODES,
  describeLivePreviewChange,
  formatPhase,
  formatSourceKind,
  historyOnlyLabel,
  moneyDelta,
  previewForwardLabel,
} from "./historicCorrections";

/**
 * SCORE-43 — Correct historical record (replaces silent Historic save-on-blur).
 *
 *   const result = await historicCorrectionDialog({ leagueId, rowId, updates, … });
 *   // null if cancelled; otherwise API result after publish
 */
function HistoricCorrectionPanel({
  leagueId,
  rowId,
  updates,
  playerName,
  seasonYear,
  onResolve,
}) {
  const reasonRef = useRef(null);
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState(CORRECTION_MODES.HISTORY_ONLY);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch(
          `/api/hub/league/${leagueId}/contract-history/${rowId}/correction-context`,
        );
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        if (!cancelled) setCtx(data);
      } catch (e) {
        if (!cancelled) setError(connectionErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, rowId]);

  useEffect(() => {
    if (!loading && !error) reasonRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onResolve(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [loading, error, busy, onResolve]);

  const original = ctx?.original || {};
  const proposed = useMemo(() => ({ ...original, ...updates }), [original, updates]);
  const season = ctx?.season_year ?? seasonYear;
  const planningSeason = preview?.live_preview?.planning_season
    ?? (season != null ? Number(season) + 1 : null);
  const reasonOk = reason.trim().length >= 3;

  const fieldRows = useMemo(() => {
    const keys = Object.keys(updates || {});
    const seen = new Set();
    const rows = [];
    for (const key of keys) {
      if (key === "base_salary" && keys.includes("cap_hit")) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const delta = moneyDelta(original[key], proposed[key]);
      rows.push({
        key,
        label: key === "cap_hit" ? "Cap hit" : key === "prior_salary" ? "Prior $" : key.replace(/_/g, " "),
        before: original[key],
        after: proposed[key],
        changed: delta.changed,
      });
    }
    return rows;
  }, [updates, original, proposed]);

  const postCorrect = async (body) => {
    const res = await apiFetch(
      `/api/hub/league/${leagueId}/contract-history/${rowId}/correct`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  };

  const publishHistoryOnly = async () => {
    if (!reasonOk) return;
    setBusy(true);
    setError("");
    try {
      const result = await postCorrect({
        reason: reason.trim(),
        mode: CORRECTION_MODES.HISTORY_ONLY,
        updates,
      });
      onResolve(result);
    } catch (e) {
      setError(connectionErrorMessage(e));
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!reasonOk) return;
    setBusy(true);
    setError("");
    try {
      const result = await postCorrect({
        reason: reason.trim(),
        mode: CORRECTION_MODES.PREVIEW_FORWARD,
        updates,
      });
      setPreview(result);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const applyForward = async () => {
    if (!reasonOk) return;
    setBusy(true);
    setError("");
    try {
      const result = await postCorrect({
        reason: reason.trim(),
        mode: CORRECTION_MODES.APPLY_FORWARD,
        updates,
        forward_rebuild_approved: true,
      });
      onResolve(result);
    } catch (e) {
      setError(connectionErrorMessage(e));
      setBusy(false);
    }
  };

  const name = ctx?.row?.player_name || playerName || "Player";

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onResolve(null);
      }}
    >
      <div
        className="confirm-card panel hub-historic-correction-card"
        role="dialog"
        aria-modal="true"
        aria-label="Correct historical record"
      >
        <h3 className="confirm-title">Correct historical record</h3>
        <p className="confirm-message">
          {name}
          {season != null ? ` · ${season}` : ""}
          {" — publishes a new snapshot version. Live planning roster stays unchanged unless you approve a forward rebuild."}
        </p>

        {loading ? (
          <p className="chart-note">Loading correction context…</p>
        ) : (
          <>
            <dl className="hub-correction-meta">
              <div>
                <dt>Source</dt>
                <dd>{formatSourceKind(ctx?.source_kind || original.source_kind)}</dd>
              </div>
              <div>
                <dt>Contract phase</dt>
                <dd>{formatPhase(ctx?.contract_phase || original.contract_phase)}</dd>
              </div>
              <div>
                <dt>Snapshot phase</dt>
                <dd>{formatPhase(ctx?.snapshot_phase)}</dd>
              </div>
              <div>
                <dt>Snapshot rev</dt>
                <dd>{ctx?.historic_snapshot_revision ?? "—"}</dd>
              </div>
            </dl>

            <table className="hub-correction-values">
              <thead>
                <tr>
                  <th>Field</th>
                  <th className="num">Original</th>
                  <th className="num">Corrected</th>
                </tr>
              </thead>
              <tbody>
                {fieldRows.map((row) => (
                  <tr key={row.key} className={row.changed ? "hub-correction-changed" : undefined}>
                    <td>{row.label}</td>
                    <td className="num">
                      {typeof row.before === "number" || (row.before != null && row.before !== "" && Number.isFinite(Number(row.before)))
                        ? fmtSal(row.before)
                        : (row.before ?? "—")}
                    </td>
                    <td className="num">
                      {typeof row.after === "number" || (row.after != null && row.after !== "" && Number.isFinite(Number(row.after)))
                        ? fmtSal(row.after)
                        : (row.after ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <label className="hub-prompt-field">
              <span className="hub-filter-label">Correction reason</span>
              <textarea
                ref={reasonRef}
                className="search-input hub-prompt-textarea"
                rows={3}
                value={reason}
                disabled={busy || Boolean(preview)}
                placeholder="Why is this historic value wrong?"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>

            {!preview ? (
              <fieldset className="hub-correction-modes" disabled={busy}>
                <legend className="hub-filter-label">Publish mode</legend>
                <label className="hub-correction-mode">
                  <input
                    type="radio"
                    name="historic-correction-mode"
                    checked={mode === CORRECTION_MODES.HISTORY_ONLY}
                    onChange={() => setMode(CORRECTION_MODES.HISTORY_ONLY)}
                  />
                  <span>
                    <strong>{historyOnlyLabel(season)}</strong>
                    <span className="chart-note"> Correct this season’s published sheet only. Live roster stays as-is.</span>
                  </span>
                </label>
                <label className="hub-correction-mode">
                  <input
                    type="radio"
                    name="historic-correction-mode"
                    checked={mode === CORRECTION_MODES.PREVIEW_FORWARD}
                    onChange={() => setMode(CORRECTION_MODES.PREVIEW_FORWARD)}
                  />
                  <span>
                    <strong>{previewForwardLabel(planningSeason)}</strong>
                    <span className="chart-note"> Preview proposed live changes; apply only after you approve.</span>
                  </span>
                </label>
              </fieldset>
            ) : (
              <div className="hub-correction-preview" role="status">
                <p className="hub-correction-preview-title">Forward rebuild preview</p>
                <p className="confirm-message">{describeLivePreviewChange(preview.live_preview)}</p>
                <p className="chart-note">
                  Approving publishes the historic correction and applies the live change above.
                  History-only is unavailable once you preview — cancel and reopen to switch.
                </p>
              </div>
            )}
          </>
        )}

        {error ? <p className="error hub-correction-error">{error}</p> : null}

        <div className="confirm-actions">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={() => onResolve(null)}
          >
            Cancel
          </button>
          {!preview ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || loading || !reasonOk || Boolean(error && !ctx)}
              onClick={() => {
                if (mode === CORRECTION_MODES.PREVIEW_FORWARD) void runPreview();
                else void publishHistoryOnly();
              }}
            >
              {busy
                ? "Working…"
                : mode === CORRECTION_MODES.PREVIEW_FORWARD
                  ? "Preview forward"
                  : "Publish history only"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !reasonOk}
              onClick={() => void applyForward()}
            >
              {busy ? "Applying…" : "Approve & apply forward"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function historicCorrectionDialog({
  leagueId,
  rowId,
  updates,
  playerName = "",
  seasonYear = null,
} = {}) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const cleanup = (result) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(
      <HistoricCorrectionPanel
        leagueId={leagueId}
        rowId={rowId}
        updates={updates || {}}
        playerName={playerName}
        seasonYear={seasonYear}
        onResolve={cleanup}
      />,
    );
  });
}

export default historicCorrectionDialog;
