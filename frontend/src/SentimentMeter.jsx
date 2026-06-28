import React from "react";
import HoverTip, { TipLine, TipTitle } from "./HoverTip";

/**
 * Horizontal sentiment gauge from bearish (-1) to bullish (+1).
 */
export default function SentimentMeter({ score, size = "md" }) {
  const raw = Number(score);
  if (!Number.isFinite(raw)) {
    return <span className="sentiment-meter sentiment-meter-empty" aria-hidden="true" />;
  }

  const clamped = Math.max(-1, Math.min(1, raw));
  const pct = ((clamped + 1) / 2) * 100;
  const tone =
    clamped >= 0.2 ? "bullish" : clamped <= -0.2 ? "bearish" : clamped >= 0 ? "slight-pos" : "slight-neg";

  const tip = (
    <>
      <TipTitle>Sentiment score {clamped.toFixed(2)}</TipTitle>
      <TipLine>Bearish ← neutral → bullish</TipLine>
    </>
  );

  return (
    <HoverTip content={tip} variant="dark" className="sentiment-meter-tip">
      <div
        className={`sentiment-meter sentiment-meter-${size} sentiment-meter-${tone}`}
        aria-label={`Sentiment ${clamped.toFixed(2)} on scale from bearish to bullish`}
        role="img"
      >
        <div className="sentiment-meter-track">
          <span className="sentiment-meter-needle" style={{ left: `${pct}%` }} />
        </div>
        {size !== "sm" && (
          <div className="sentiment-meter-labels" aria-hidden="true">
            <span>−</span>
            <span>+</span>
          </div>
        )}
      </div>
    </HoverTip>
  );
}
