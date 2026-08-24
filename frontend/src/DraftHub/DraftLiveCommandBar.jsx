import React from "react";
import DraftDeadlineClock from "./DraftDeadlineClock";
import { fmtSal } from "./rosterFormat";
import {
  bidRelation,
  bidRelationLabel,
  connectionStatusLabel,
} from "./draftLiveConsole";

function playerShortName(nominee) {
  const full = nominee?.player_name || nominee?.player || "";
  const parts = String(full).trim().split(/\s+/);
  if (parts.length < 2) return full || "On the block";
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

export default function DraftLiveCommandBar({
  session,
  nominee,
  teams = [],
  myTeamId,
  myBudget,
  myMaxBid,
  suggestedBid,
  minBid,
  bidAmount,
  onBidAmountChange,
  onBidAmountFocus,
  onBidAmountBlur,
  onBid,
  bidDisabled = false,
  pendingAction = "",
  isCommissioner = false,
  onAward,
  nominatorTeam,
  nextNominatorTeam,
  isMyNominationTurn = false,
  connectionStatus = "connecting",
  paused = false,
  canNominate = false,
  onNominate,
  nominateLabel,
  pickDraft = false,
  pickClock = null,
}) {
  const status = session?.status;
  const picking = pickDraft || status === "picking";
  const highBid = Number(session?.high_bid || 0);
  const relation = bidRelation({
    myTeamId,
    highBidderTeamId: session?.high_bidder_team_id,
  });
  const deadline = status === "bidding"
    ? session?.bid_deadline
    : session?.nomination_deadline;
  const nextBid = suggestedBid ?? (highBid + Number(minBid || 1));
  const connLabel = connectionStatusLabel(connectionStatus);

  const submitBid = (event) => {
    event.preventDefault();
    if (!bidDisabled) onBid?.();
  };

  return (
    <div className="hub-draft-live-command" role="region" aria-label={picking ? "Live pick command bar" : "Live auction command bar"}>
      <div className="hub-draft-live-command-main">
        <span
          className={`hub-draft-conn hub-draft-conn--${connectionStatus}`}
          title={connectionStatus === "live" ? "Realtime connection is up" : "Draft updates may be delayed"}
        >
          {connLabel}
        </span>
        {status === "bidding" && nominee ? (
          <>
            <strong className="hub-draft-live-command-player">{playerShortName(nominee)}</strong>
            <span className="hub-draft-live-command-price">
              Current {fmtSal(highBid || minBid || 1)}
            </span>
            <span className={`hub-draft-live-command-rel hub-draft-live-command-rel--${relation}`}>
              {bidRelationLabel(relation)}
            </span>
          </>
        ) : (
          <>
            <strong className="hub-draft-live-command-player">
              {picking
                ? (isMyNominationTurn ? "Your pick" : `On the clock: ${nominatorTeam?.name || "a team"}`)
                : (isMyNominationTurn ? "Your turn to nominate" : `Waiting for ${nominatorTeam?.name || "nominator"}`)}
            </strong>
            {picking && pickClock?.round ? (
              <span className="hub-draft-live-command-next">
                Round {pickClock.round} · Pick {pickClock.overall}
              </span>
            ) : nextNominatorTeam?.name ? (
              <span className="hub-draft-live-command-next">
                Next {nextNominatorTeam.name}
              </span>
            ) : null}
          </>
        )}
        <DraftDeadlineClock
          deadline={deadline}
          paused={paused}
          className="hub-draft-live-command-clock"
        />
      </div>

      <div className="hub-draft-live-command-actions">
        {status === "bidding" ? (
          <form className="hub-draft-live-command-bid" onSubmit={submitBid}>
            <label className="sr-only" htmlFor="hub-live-bid-amount">Bid amount</label>
            <input
              id="hub-live-bid-amount"
              type="number"
              className="hub-bid-input"
              value={bidAmount}
              min={nextBid}
              step={minBid || 1}
              onFocus={onBidAmountFocus}
              onBlur={onBidAmountBlur}
              onChange={(e) => onBidAmountChange?.(e.target.value)}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={bidDisabled}
            >
              {pendingAction === "bid" ? "Bidding…" : `Bid ${fmtSal(bidAmount || nextBid)}`}
            </button>
          </form>
        ) : canNominate ? (
          <button type="button" className="btn-primary" onClick={onNominate} disabled={bidDisabled}>
            {nominateLabel || (picking ? "Pick" : `Nominate for ${fmtSal(minBid || 1)}`)}
          </button>
        ) : null}
        {!picking && Number.isFinite(Number(myBudget)) && (
          <span className="hub-draft-live-command-cap">
            {fmtSal(myBudget)} left
            {myMaxBid != null && <> · max {fmtSal(myMaxBid)}</>}
          </span>
        )}
        {isCommissioner && status === "bidding" && session?.high_bidder_team_id && (
          <button
            type="button"
            className="btn-ghost btn-sm hub-draft-award-now"
            onClick={onAward}
            title="Commissioner only — settle this auction immediately"
          >
            Award now {fmtSal(highBid)}
          </button>
        )}
      </div>
    </div>
  );
}
