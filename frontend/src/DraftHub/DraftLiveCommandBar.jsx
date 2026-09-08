import React, { useState } from "react";
import DraftDeadlineClock from "./DraftDeadlineClock";
import { fmtSal } from "./rosterFormat";
import {
  bidAmountAriaInvalid,
  bidAmountInputLocked,
  bidAmountSubmitLocked,
  bidRelation,
  bidRelationLabel,
  sanitizeBidAmountInput,
  shouldSwallowBidDeleteKey,
} from "./draftLiveConsole";
import {
  draftLiveCopy,
  nominationJobLine,
  nextOwnerLine,
} from "./draftLivePresentation";

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
  canAward = false,
  onAward,
  nominatorTeam,
  nextNominatorTeam,
  isMyNominationTurn = false,
  connectionStatus = "connecting",
  paused = false,
  pausedLabel = "Paused",
  canResume = false,
  onResume,
  pickDraft = false,
  pickClock = null,
  modeLabel = "",
  leagueLabel = "",
  utilityActions = null,
  hideClock = false,
  offline = false,
  recordDock = null,
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
  const connLive = connectionStatus === "live";
  const jobLine = nominationJobLine({
    picking,
    isMyTurn: isMyNominationTurn,
    nominatorName: nominatorTeam?.name,
    paused: Boolean(paused),
    offline,
  });
  const nextLine = offline
    ? ""
    : picking && pickClock?.round
      ? `Round ${pickClock.round} · Pick ${pickClock.overall}`
      : nextOwnerLine(nextNominatorTeam?.name);
  const showResume = Boolean(canResume);
  const showBid = status === "bidding" && !showResume;
  const [focusedDraft, setFocusedDraft] = useState(null);
  const fieldValue = focusedDraft != null ? focusedDraft : bidAmount;
  const inputLocked = bidAmountInputLocked({
    controlsLocked: bidDisabled,
    positionBlocked: false,
  });
  const submitLocked = bidAmountSubmitLocked({
    controlsLocked: bidDisabled,
    amount: fieldValue,
    minBid: nextBid,
  });
  const amountInvalid = bidAmountAriaInvalid({
    inputLocked,
    amount: fieldValue,
    minBid: nextBid,
  });

  const submitBid = (event) => {
    event.preventDefault();
    if (!submitLocked) onBid?.();
  };

  const changeBidAmount = (event) => {
    const next = sanitizeBidAmountInput(event.target.value);
    if (next == null) return;
    if (focusedDraft != null) setFocusedDraft(next);
    onBidAmountChange?.(next);
  };

  const onAmountKeyDown = (event) => {
    if (!shouldSwallowBidDeleteKey({ key: event.key, amount: fieldValue })) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onAmountFocus = (event) => {
    setFocusedDraft(event.target.value ?? "");
    onBidAmountFocus?.(event);
  };

  const onAmountBlur = (event) => {
    setFocusedDraft(null);
    onBidAmountBlur?.(event);
  };

  return (
    <div className="hub-draft-live-command" role="region" aria-label={picking ? "Live pick command bar" : "Live auction command bar"}>
      <div className="hub-draft-live-command-main">
        {(modeLabel || leagueLabel) && (
          <div className="hub-draft-live-command-context">
            {modeLabel && <span className="hub-draft-experience-kicker">{modeLabel}</span>}
            {leagueLabel && <span>{leagueLabel}</span>}
          </div>
        )}
        <div className="hub-draft-live-command-status">
          <span
            className={`hub-draft-conn hub-draft-conn--${connectionStatus}`}
            title={connLive ? draftLiveCopy.connectionLive : draftLiveCopy.connectionDelay}
          >
            <span className="sr-only">{connLive ? "Live" : connectionStatus}</span>
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
              <strong className="hub-draft-live-command-player">{jobLine}</strong>
              {nextLine ? (
                <span className="hub-draft-live-command-next">{nextLine}</span>
              ) : null}
            </>
          )}
          {hideClock ? null : (
            <DraftDeadlineClock
              deadline={deadline}
              paused={paused}
              pausedLabel={pausedLabel}
              className="hub-draft-live-command-clock"
            />
          )}
        </div>
        {recordDock}
      </div>

      <div className="hub-draft-live-command-actions">
        {showResume ? (
          <button
            type="button"
            className="btn-primary"
            onClick={onResume}
            disabled={Boolean(pendingAction) && pendingAction !== "resume"}
          >
            {draftLiveCopy.resume}
          </button>
        ) : showBid ? (
          <form className="hub-draft-live-command-bid" onSubmit={submitBid}>
            <label className="sr-only" htmlFor="hub-live-bid-amount">Bid amount</label>
            <input
              id="hub-live-bid-amount"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="hub-bid-input"
              value={fieldValue}
              aria-invalid={amountInvalid}
              disabled={inputLocked}
              onFocus={onAmountFocus}
              onBlur={onAmountBlur}
              onChange={changeBidAmount}
              onKeyDown={onAmountKeyDown}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={submitLocked}
            >
              {pendingAction === "bid" ? "Bidding…" : `Bid ${fmtSal(bidAmount || nextBid)}`}
            </button>
          </form>
        ) : null}
        {!picking && Number.isFinite(Number(myBudget)) && (
          <span className="hub-draft-live-command-cap">
            {fmtSal(myBudget)} {draftLiveCopy.leftover}
            {myMaxBid != null && <> · {draftLiveCopy.maxBid} {fmtSal(myMaxBid)}</>}
          </span>
        )}
        {isCommissioner && canAward && status === "bidding" && (
          <button
            type="button"
            className="btn-ghost btn-sm hub-draft-award-now"
            onClick={onAward}
            disabled={bidDisabled}
            title="Settle this auction for your high bid"
          >
            Award now {fmtSal(highBid)}
          </button>
        )}
        {utilityActions}
      </div>
    </div>
  );
}
