import React, { useEffect, useRef } from "react";
import { bidBlockedByCeiling, parseWalkaway } from "./faWalkaway";
import {
  FA_BID_COPY,
  faBidSupport,
  faWalkawayAbove,
} from "./faBidPresentation";

export default function FaBidDialog({
  playerName,
  amount,
  ceiling,
  firstPrompt = false,
  onChangeAmount,
  onChangeCeiling,
  onPlace,
  onBidAtCeiling,
  onRaiseCeiling,
  onPass,
  busy = false,
}) {
  const amountRef = useRef(null);
  const onPassRef = useRef(onPass);
  const blocked = bidBlockedByCeiling(amount, ceiling);
  const parsedBid = parseWalkaway(amount);
  const bid = parsedBid ?? 1;
  const cap = parseWalkaway(ceiling);

  useEffect(() => {
    onPassRef.current = onPass;
  }, [onPass]);

  useEffect(() => {
    amountRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onPassRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onPassRef.current?.();
      }}
    >
      <div
        className="confirm-card panel hub-prompt-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fa-bid-title"
      >
        <h3 className="confirm-title" id="fa-bid-title">{FA_BID_COPY.title}</h3>
        <p className="confirm-message">{faBidSupport(playerName, bid)}</p>
        {firstPrompt ? <p className="chart-note">{FA_BID_COPY.firstCeiling}</p> : null}
        <label className="hub-prompt-field">
          <span className="hub-filter-label">{FA_BID_COPY.amountLabel}</span>
          <input
            ref={amountRef}
            className="search-input"
            type="number"
            min={1}
            step={1}
            value={amount ?? ""}
            onChange={(e) => onChangeAmount?.(e.target.value)}
          />
        </label>
        <label className="hub-prompt-field">
          <span className="hub-filter-label">{FA_BID_COPY.ceilingLabel}</span>
          <input
            className="search-input"
            type="number"
            min={1}
            step={1}
            value={ceiling ?? ""}
            placeholder={FA_BID_COPY.walkAwayPrompt}
            onChange={(e) => onChangeCeiling?.(e.target.value)}
          />
        </label>
        {blocked ? (
          <p className="hub-fa-bid-warn">{faWalkawayAbove(cap)}</p>
        ) : null}
        <div className="confirm-actions hub-fa-bid-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={onPass} disabled={busy}>
            {FA_BID_COPY.pass}
          </button>
          {blocked ? (
            <>
              <button type="button" className="btn-ghost btn-sm" onClick={onBidAtCeiling} disabled={busy || cap == null}>
                {FA_BID_COPY.bidAtCeiling}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={onRaiseCeiling} disabled={busy}>
                {FA_BID_COPY.raiseCeiling}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || blocked || parsedBid == null}
            onClick={onPlace}
          >
            {busy ? FA_BID_COPY.bidding : FA_BID_COPY.placeBid}
          </button>
        </div>
      </div>
    </div>
  );
}
