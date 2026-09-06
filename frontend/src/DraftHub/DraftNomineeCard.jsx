import React, { useEffect, useState } from "react";
import Chip, { sentimentChipTone } from "../Chip";
import { mentionCountLabel } from "../format";
import { pickFantasyMediaDigest } from "../fantasyMediaDigest";
import { PAINT_WIDTH, playerInitials, teamLogoUrl, headshotCandidates, paintMediaUrl } from "./draftMedia";
import { useDeadlineSeconds } from "./DraftDeadlineClock";
import { fmtSal } from "./rosterFormat";
import { formatCountdown } from "./draftRoomHelpers";
import TeamIdentityMark from "./TeamIdentityMark";
import { displayBotName, botIdentityLook, resolveBotPersona } from "./botPersona";
import {
  BID_PULSE_MS,
  clockRingOffset,
  clockUrgency,
} from "./draftAuctionTheater";
import { draftLiveCopy, soldPriceLine, soldTone } from "./draftLivePresentation";

const RING_R = 54;
const RING_CIRC = 2 * Math.PI * RING_R;

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
  const bidLabel = stats.bidLabel || (stats.useRaav ? "Bid to" : "Fair value");
  if (stats.bidTo != null) {
    items.push({
      label: bidLabel,
      value: stats.raavDeltaLabel
        ? `${fmtSal(stats.bidTo)} (${stats.raavDeltaLabel})`
        : fmtSal(stats.bidTo),
    });
  } else if (stats.fairValue != null) {
    items.push({ label: "Fair value", value: fmtSal(stats.fairValue) });
  }
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

function PlayerAvatar({
  name,
  headshotUrl,
  espnHeadshotUrl,
  team,
  teamLogoUrl: logoOverride,
  size = "lg",
}) {
  const [shotIndex, setShotIndex] = useState(0);
  const [logoFailed, setLogoFailed] = useState(false);
  const paintWidth = size === "lg" ? PAINT_WIDTH.hero : PAINT_WIDTH.mark;
  const shots = headshotCandidates({ headshot_url: headshotUrl, espn_headshot_url: espnHeadshotUrl }, [], { width: paintWidth });
  const headshot = shots[shotIndex] || null;
  const logo = paintMediaUrl(logoOverride, paintWidth) || teamLogoUrl(team, { width: paintWidth });
  const showHeadshot = Boolean(headshot);
  const logoAsMain = !showHeadshot && logo && !logoFailed;

  useEffect(() => {
    setShotIndex(0);
    setLogoFailed(false);
  }, [headshotUrl, espnHeadshotUrl, name]);

  return (
    <div className={`hub-draft-avatar-core hub-draft-avatar-${size}`}>
      {showHeadshot ? (
        <img
          className="hub-draft-headshot"
          src={headshot}
          alt=""
          loading="lazy"
          onError={() => setShotIndex((index) => index + 1)}
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

function BidClockRing({
  deadline,
  paused,
  pausedLabel,
  durationSec,
}) {
  const seconds = useDeadlineSeconds(deadline, paused);
  if (paused) {
    return <span className="hub-bid-clock-label">{pausedLabel}</span>;
  }
  if (seconds == null) return null;
  const total = Math.max(Number(durationSec) || 0, seconds, 1);
  const urgency = clockUrgency(seconds);
  const offset = clockRingOffset(seconds, total, RING_CIRC);
  return (
    <>
      <svg className={`hub-bid-clock-ring is-${urgency}`} viewBox="0 0 120 120" aria-hidden>
        <circle className="hub-bid-clock-track" cx="60" cy="60" r={RING_R} />
        <circle
          className="hub-bid-clock-fill"
          cx="60"
          cy="60"
          r={RING_R}
          style={{ strokeDasharray: RING_CIRC, strokeDashoffset: offset }}
        />
      </svg>
      <span className={`hub-bid-clock-label is-${urgency}`}>{formatCountdown(seconds)}</span>
    </>
  );
}

export default function DraftNomineeCard({
  playerName,
  position,
  team,
  headshotUrl,
  espnHeadshotUrl,
  teamLogoUrl: logoOverride,
  sentiment,
  fantasyMediaDigest,
  digestLoading,
  sentimentMeta,
  highBid,
  highBidderName,
  highBidderTeam = null,
  highBidderIsBot,
  openingBid,
  timerLabel,
  timerSeconds,
  deadline,
  bidDurationSec = 30,
  paused = false,
  pausedLabel = "Paused",
  label = draftLiveCopy.onTheBlock,
  compact = false,
  stats = null,
  isWinning = false,
  sold = false,
  soldWinner = "",
  soldAmount = null,
  soldFair = null,
}) {
  const digest = fantasyMediaDigest || pickFantasyMediaDigest(sentiment) || null;
  const tagline = digest && String(digest).trim() && !/no (current-week )?fantasy narrative/i.test(digest)
    ? String(digest).trim()
    : "";
  const hasStory = Boolean(tagline);
  const labelText = sentiment?.sentiment_label_text || sentiment?.sentiment_label;
  const [pulse, setPulse] = useState(false);
  const [flash, setFlash] = useState(false);
  const bidKey = `${highBid ?? ""}:${highBidderName || ""}`;

  useEffect(() => {
    if (highBid == null && !highBidderName) return undefined;
    setPulse(true);
    setFlash(true);
    const pulseId = setTimeout(() => setPulse(false), BID_PULSE_MS);
    const flashId = setTimeout(() => setFlash(false), 200);
    return () => {
      clearTimeout(pulseId);
      clearTimeout(flashId);
    };
  }, [bidKey, highBid, highBidderName]);

  const persona = highBidderTeam ? resolveBotPersona(highBidderTeam) : resolveBotPersona({
    name: highBidderName,
    is_bot: highBidderIsBot,
  });
  const bidderLabel = highBidderTeam
    ? displayBotName(highBidderTeam.name, highBidderTeam)
    : displayBotName(highBidderName, { name: highBidderName, is_bot: highBidderIsBot });
  const showClock = Boolean(deadline || timerSeconds != null);
  const soldKind = soldTone({ amount: soldAmount, fair: soldFair ?? stats?.fairValue });

  const classes = [
    "hub-nominee-card",
    compact ? "hub-nominee-card-compact" : "",
    isWinning && !sold ? "is-winning" : "",
    sold ? "is-sold" : "",
    pulse && !sold ? "is-bid-pulse" : "",
  ].filter(Boolean).join(" ");

  return (
    <article className={classes}>
      <header className="hub-nominee-header">
        <div className="hub-nominee-header-left">
          {label && <span className="hub-nominee-label">{sold ? draftLiveCopy.soldLabel : label}</span>}
          {hasStory && labelText && !sold && (
            <Chip tone={sentimentChipTone(sentiment.sentiment_label)} className="hub-nominee-tone">
              {labelText}
            </Chip>
          )}
        </div>
      </header>

      <div className="hub-nominee-body">
        <div className="hub-draft-avatar-wrap">
          <PlayerAvatar
            name={playerName}
            headshotUrl={headshotUrl}
            espnHeadshotUrl={espnHeadshotUrl}
            team={team}
            teamLogoUrl={logoOverride}
            size={compact ? "md" : "lg"}
          />
          {showClock && !sold && (
            deadline
              ? (
                <BidClockRing
                  deadline={deadline}
                  paused={paused}
                  pausedLabel={pausedLabel}
                  durationSec={bidDurationSec}
                />
              )
              : <span className="hub-bid-clock-label">{timerLabel || `${timerSeconds}s`}</span>
          )}
          {sold && (
            <span className="hub-nominee-sold-stamp" aria-hidden>{draftLiveCopy.soldStamp}</span>
          )}
        </div>

        <div className="hub-nominee-details">
          <div className="hub-nominee-identity">
            <h3 className="hub-nominee-name">{playerName}</h3>
            <p className="hub-nominee-meta">
              <span>{position}</span>
              <span className="hub-nominee-dot">·</span>
              <span>{team || "—"}</span>
            </p>
            {(tagline || digestLoading) && !sold && (
              <p className="hub-nominee-tagline">
                {digestLoading ? "Summarizing…" : tagline}
                {sentiment?.mention_count ? (
                  <span className="hub-nominee-tagline-meta"> · {mentionCountLabel(sentiment.mention_count)}</span>
                ) : null}
              </p>
            )}
          </div>

          {!sold && <NomineeStats stats={stats} />}

          {sold ? (
            <div className={`hub-nominee-sold-row is-${soldKind}`} role="status">
              <div className="hub-bid-stat">
                <span className="hub-cap-label">{draftLiveCopy.winner}</span>
                <strong className="hub-high-bidder">
                  {(highBidderIsBot || persona) && (
                    <TeamIdentityMark
                      team={highBidderTeam || { name: soldWinner || bidderLabel, is_bot: true }}
                      identity={botIdentityLook(highBidderTeam || { name: soldWinner || bidderLabel, is_bot: true })}
                      size="sm"
                    />
                  )}
                  {soldWinner || bidderLabel}
                </strong>
              </div>
              <div className="hub-bid-stat">
                <span className="hub-cap-label">{draftLiveCopy.vsFair}</span>
                <strong className="hub-sold-price">
                  {soldPriceLine({ amount: soldAmount ?? highBid, fair: soldFair ?? stats?.fairValue })}
                </strong>
              </div>
            </div>
          ) : (highBid != null || highBidderName || openingBid != null) && (
            <div className={`hub-nominee-bid-row${flash ? (isWinning ? " is-flash-you" : " is-flash-them") : ""}`}>
              {highBidderName ? (
                <>
                  {highBid != null && (
                    <div className="hub-bid-stat">
                      <span className="hub-cap-label">{draftLiveCopy.highBid}</span>
                      <strong className={`hub-high-bid${isWinning ? " is-winning" : ""}`}>
                        ${Number(highBid).toFixed(0)}
                      </strong>
                    </div>
                  )}
                  <div className="hub-bid-stat hub-bid-stat-bidder">
                    <span className="hub-cap-label">{draftLiveCopy.highBidder}</span>
                    <strong className="hub-high-bidder">
                      {(highBidderIsBot || persona) && (
                        <TeamIdentityMark
                          team={highBidderTeam || { name: bidderLabel, is_bot: true }}
                          identity={botIdentityLook(highBidderTeam || { name: bidderLabel, is_bot: true })}
                          size="sm"
                        />
                      )}
                      {bidderLabel}
                    </strong>
                    {persona?.hint && <span className="chart-note hub-bot-hint">{persona.hint}</span>}
                  </div>
                </>
              ) : (
                <div className="hub-bid-stat">
                  <span className="hub-cap-label">{draftLiveCopy.openingBid}</span>
                  <strong className="hub-high-bid">${Number(openingBid ?? 1).toFixed(0)}</strong>
                  <span className="chart-note hub-bid-waiting">{draftLiveCopy.waitingFirstBid}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
