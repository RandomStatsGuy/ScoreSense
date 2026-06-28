import React, { useState } from "react";
import SentimentBadge from "../SentimentBadge";
import Chip, { sentimentChipTone } from "../Chip";
import { mentionCountLabel } from "../format";
import { playerInitials, teamLogoUrl } from "./draftMedia";
import DraftDeadlineClock from "./DraftDeadlineClock";

function PlayerAvatar({ name, headshotUrl, team, teamLogoUrl: logoOverride, size = "lg" }) {
  const [imgFailed, setImgFailed] = useState(false);
  const logo = logoOverride || teamLogoUrl(team);

  return (
    <div className={`hub-draft-avatar-wrap hub-draft-avatar-${size}`}>
      {headshotUrl && !imgFailed ? (
        <img
          className="hub-draft-headshot"
          src={headshotUrl}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="hub-draft-headshot hub-draft-headshot-fallback" aria-hidden>
          {playerInitials(name)}
        </div>
      )}
      {logo && (
        <img className="hub-draft-team-badge" src={logo} alt="" loading="lazy" />
      )}
    </div>
  );
}

export default function DraftNomineeCard({
  playerName,
  position,
  team,
  headshotUrl,
  teamLogoUrl: logoOverride,
  sentiment,
  beatDigest,
  digestLoading,
  sentimentMeta,
  highBid,
  highBidderName,
  highBidderIsBot,
  openingBid,
  timerLabel,
  timerSeconds,
  deadline,
  label = "On the block",
  compact = false,
}) {
  const digest = beatDigest || sentiment?.beat_digest;
  const hasStory = sentiment && Number(sentiment.mention_count) > 0;
  const labelText = sentiment?.sentiment_label_text || sentiment?.sentiment_label;

  return (
    <article className={`hub-nominee-card${compact ? " hub-nominee-card-compact" : ""}`}>
      <header className="hub-nominee-header">
        <div className="hub-nominee-header-left">
          {label && <span className="hub-nominee-label">{label}</span>}
          {hasStory && labelText && (
            <Chip tone={sentimentChipTone(sentiment.sentiment_label)} className="hub-nominee-tone">
              {labelText}
            </Chip>
          )}
        </div>
        {(deadline || timerSeconds != null) && (
          deadline
            ? <DraftDeadlineClock deadline={deadline} className="hub-timer" />
            : <span className="hub-timer">{timerLabel || `${timerSeconds}s`}</span>
        )}
      </header>

      <div className="hub-nominee-body">
        <PlayerAvatar
          name={playerName}
          headshotUrl={headshotUrl}
          team={team}
          teamLogoUrl={logoOverride}
          size={compact ? "md" : "lg"}
        />

        <div className="hub-nominee-details">
          <div className="hub-nominee-identity">
            <h3 className="hub-nominee-name">{playerName}</h3>
            <p className="hub-nominee-meta">
              <span>{position}</span>
              <span className="hub-nominee-dot">·</span>
              <span>{team || "—"}</span>
            </p>
          </div>

          {hasStory ? (
            <div className="hub-draft-story">
              <div className="hub-draft-story-head">
                <span className="hub-draft-story-kicker">
                  Beat report
                  {sentimentMeta?.week ? ` · Wk ${sentimentMeta.week}` : ""}
                  {sentimentMeta?.context_fallback ? " · latest" : ""}
                </span>
                <span className="hub-draft-story-mentions">{mentionCountLabel(sentiment.mention_count)}</span>
              </div>
              {digestLoading ? (
                <p className="hub-draft-story-text hub-draft-story-loading">Summarizing beat reports…</p>
              ) : (
                <p className="hub-draft-story-text">{digest}</p>
              )}
              {sentiment.sources?.length ? (
                <div className="hub-draft-story-sources">
                  {sentiment.sources.slice(0, 3).map((src) => (
                    <span key={`${src.label}-${src.network}`} className="hub-draft-source-pill">
                      {src.network_label || src.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="hub-draft-no-story">
              No beat narrative this week
              {sentimentMeta?.week ? ` (Week ${sentimentMeta.week})` : ""}.
            </p>
          )}

          {(highBid != null || highBidderName || openingBid != null) && (
            <div className="hub-nominee-bid-row">
              {highBidderName ? (
                <>
                  {highBid != null && (
                    <div className="hub-bid-stat">
                      <span className="hub-cap-label">High bid</span>
                      <strong className="hub-high-bid">${Number(highBid).toFixed(0)}</strong>
                    </div>
                  )}
                  <div className="hub-bid-stat">
                    <span className="hub-cap-label">High bidder</span>
                    <strong>{highBidderName}{highBidderIsBot ? " 🤖" : ""}</strong>
                  </div>
                </>
              ) : (
                <div className="hub-bid-stat">
                  <span className="hub-cap-label">Opening bid</span>
                  <strong className="hub-high-bid">${Number(openingBid ?? 1).toFixed(0)}</strong>
                  <span className="chart-note hub-bid-waiting">Waiting for first bid…</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
