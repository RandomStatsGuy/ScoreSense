import "./styles/player-details.css";
import React, { useEffect, useState } from "react";
import { apiFetch } from "./auth";
import { connectionErrorMessage, parseApiError } from "./format";
import { isAbortError } from "./fetchAbort";
import {HubLoadingSkeleton} from "./DraftHub/HubUILayout";
import {PLAYER_CARD_COPY as COPY} from "./projectionsPresentation";
import { typicalMissLine } from "./accuracyPresentation";

function directionGlyph(direction) {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "·";
}

function SignalRow({ signal }) {
  const dir = signal?.direction || "neutral";
  return (
    <li
      className={`projection-explanation-signal projection-explanation-signal--${dir} projection-explanation-signal--${signal?.strength || "low"}`}
    >
      <span className="projection-explanation-signal-dir" aria-hidden="true">
        {directionGlyph(dir)}
      </span>
      <div className="projection-explanation-signal-body">
        <span className="projection-explanation-signal-label">{signal.label}</span>
        {signal.detail ? (
          <p className="projection-explanation-signal-detail">{signal.detail}</p>
        ) : null}
      </div>
      <span className="sr-only">
        {dir === "up" ? "Positive" : dir === "down" ? "Negative" : "Neutral"} signal
      </span>
    </li>
  );
}

/**
 * Structured "Why this projection?" panel — GET /api/player/{id}/explanation (SCORE-5).
 * Render only useful projection signals and the position-specific typical miss.
 */
export default function ProjectionExplanationPanel({
  playerId,
  season,
  week,
  position,
  applyInjuryAdjustments = true,
  active = true,
  className = "",
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typicalMiss, setTypicalMiss] = useState("");

  useEffect(() => {
    const pos = String(position || "").trim().toLowerCase();
    if (!active || !pos || !["qb", "rb", "wr", "te"].includes(pos)) {
      setTypicalMiss("");
      return undefined;
    }
    const queryPos = pos === "te" ? "wr" : pos;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(
          `/api/accuracy?position=${encodeURIComponent(queryPos)}`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const report = await res.json();
        const miss = report?.summary?.scoresense_avg_mae;
        if (!controller.signal.aborted) {
          setTypicalMiss(typicalMissLine({ position: pos, miss }));
        }
      } catch (err) {
        if (err.name === "AbortError" || controller.signal.aborted) return;
        setTypicalMiss("");
      }
    })();
    return () => controller.abort();
  }, [active, position]);

  useEffect(() => {
    if (!active || !playerId) {
      setData(null);
      setError("");
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (season != null) params.set("season", String(season));
    if (week != null) params.set("week", String(week));
    if (position) params.set("position", String(position));
    params.set("apply_injury_adjustments", applyInjuryAdjustments ? "true" : "false");
    const q = params.toString() ? `?${params.toString()}` : "";

    (async () => {
      try {
        const res = await apiFetch(
          `/api/player/${encodeURIComponent(playerId)}/explanation${q}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to load projection explanation"));
        }
        setData(await res.json());
      } catch (err) {
        if (isAbortError(err)) return;
        setData(null);
        setError(connectionErrorMessage(err, "Failed to load projection explanation"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [active, playerId, season, week, position, applyInjuryAdjustments]);

  if (!active || !playerId) return null;

  const signals = (Array.isArray(data?.projection_signals)?data.projection_signals:[]).filter(signal=>signal?.label);
  if(!loading&&!error&&!signals.length&&!typicalMiss)return null;
  return <section className={`projection-explanation ${className}`.trim()} aria-label={COPY.details}>
    {typicalMiss ? <p className="projection-explanation-note muted">{typicalMiss}</p> : null}
    {loading&&!data ? <HubLoadingSkeleton rows={2}/> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}
    {signals.length ? <ul className="projection-explanation-signal-list">
      {signals.map(signal=><SignalRow key={signal.id||signal.label} signal={signal}/>)}
    </ul> : null}
  </section>;
}
