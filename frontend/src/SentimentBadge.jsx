import React from "react";
import Chip, { sentimentChipTone } from "./Chip";
import HoverTip, { TipLine, TipTitle } from "./HoverTip";
import { fmtMentions, mentionCountLabel } from "./format";
import { sentimentLabelText } from "./sentimentDisplay";

/**
 * Compact weekly narrative indicator for table cells and cards.
 */
export default function SentimentBadge({ sentiment, compact = false, table = false }) {
  if (!sentiment || !(Number(sentiment.mention_count) > 0)) {
    return (
      <span className={`sentiment-badge sentiment-badge-empty${table ? " sentiment-badge-table" : ""}`}>
        —
      </span>
    );
  }

  const label = sentiment.sentiment_label || "neutral";
  const text = sentiment.sentiment_label_text || sentimentLabelText(label);
  const narrative = sentiment.beat_digest || sentiment.snippet || sentiment.sentiment_summary || "";
  const rawSnippet = sentiment.snippet?.trim();

  const flags = [];
  if (Number(sentiment.injury_flag) > 0) flags.push("injury");
  if (Number(sentiment.role_hype_flag) > 0) flags.push("hype");

  const tipContent = (
    <>
      <TipTitle>{text}</TipTitle>
      <TipLine>
        {mentionCountLabel(sentiment.mention_count)}
        {flags.length ? ` · ${flags.join(", ")}` : ""}
      </TipLine>
      {narrative ? <TipLine className="hover-tip-snippet">{narrative}</TipLine> : null}
      {rawSnippet && rawSnippet !== narrative ? (
        <TipLine className="hover-tip-snippet muted">Raw: {rawSnippet}</TipLine>
      ) : null}
      {Number.isFinite(Number(sentiment.sentiment_score)) ? (
        <TipLine>Score {Number(sentiment.sentiment_score).toFixed(2)} (−1 bearish → +1 bullish)</TipLine>
      ) : null}
    </>
  );

  return (
    <HoverTip content={tipContent} variant="dark">
      <Chip
        tone={sentimentChipTone(label)}
        className={`sentiment-badge ${compact ? "sentiment-badge-compact" : ""}${table ? " sentiment-badge-table" : ""}`}
        aria-label={`${text}. ${mentionCountLabel(sentiment.mention_count)}${narrative ? `. ${narrative}` : ""}`}
      >
        <span className="sentiment-badge-label">{compact ? text.split(" ")[0] : text}</span>
        {!compact && (
          <span className="sentiment-badge-meta">
            {fmtMentions(sentiment.mention_count)}m
            {flags.length ? ` · ${flags.join(", ")}` : ""}
          </span>
        )}
      </Chip>
    </HoverTip>
  );
}
