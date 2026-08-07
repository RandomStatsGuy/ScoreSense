import React, { useState } from "react";
import SentimentBadge from "../SentimentBadge";
import Chip, { sentimentChipTone } from "../Chip";
import { mentionCountLabel } from "../format";
import { playerInitials, teamLogoUrl } from "./draftMedia";
import DraftDeadlineClock from "./DraftDeadlineClock";
import { fmtSal } from "./rosterFormat";

function fmtPts(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(digits);
}

function NomineeStats({ stats }) {
  if (!stats) return null;
  const items = [];
  const ppg = fmtPts(stats.perGame);
  const season = fmtPts(stats.seasonProj, 0);
  if (ppg != null) items.push({ label: "Proj PPG", value: ppg });
  if (season != null) items.push({ label: "Season", value: `${season} pts` });
  if (stats.fairValue != null) items.push({ label: "Fair value", value: fmtSal(stats.fairValue) });
  if (stats.minSal != null && stats.maxSal != null) {
    items.push({ label: "Range", value: `${fmtSal(stats.minSal)}–${fmtSal(stats.maxSal)}` });
  }
  if (stats.tier != null && stats.tier !== "") items.push({ label: "Tier", value: String(stats.tier) });
  if (items.length === 0) return null;
  return (
    <div className="hub-nominee-stats">
      {items.map((it) => (
        <div key={it.label} className="hub-nominee-stat">
          <span className="hub-cap-label">{it.label}</span>
          <strong>{it.value}</strong>
        </div>
      ))}
    </div>
  );
}

function PlayerAvatar({ name, headshotUrl, team, teamLogoUrl: logoOverride, size = "lg" }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = logoOverride || teamLogoUrl(team);
  const showHeadshot = headshotUrl && !imgFailed;
  const logoAsMain = !showHeadshot && logo && !logoFailed;

  return (
    <div className={`hub-draft-avatar-wrap hub-draft-avatar-${size}`}>
      {showHeadshot ? (
        <img
          className="hub-draft-headshot"
          src={headshotUrl}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : logoAsMain ? (
        <img
          className="hub-draft-headshot hub-draft-headshot-logo"
          src={logo}
          alt=""
          loading="lazy"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <div className="hub-draft-headshot hub-draft-headshot-fallback" aria-hidden>
          {playerInitials(name)}
        </div>
      )}
      {logo && showHeadshot && (
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
  stats = null,
}) {
  const digest = beatDigest || sentiment?.fantasy_digest || sentiment?.beat_digest;
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

          <NomineeStats stats={stats} />

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
                <p className="hub-draft-story-text hub-draft-story-loading">Summarizing fantasy narrative…</p>
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
              No fantasy narrative this week
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
