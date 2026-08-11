import React, { memo } from "react";
import HoverTip, { TipLine, TipTitle } from "../HoverTip";
import {
  effectiveAuctionBid,
  formatRaavDelta,
  formatRiskScore,
  raavDelta,
  raavDeltaTooltip,
} from "../riskAdjustedValue";
import { fmtSal } from "./valueSheetUtils";

function RaavBidCell({
  row,
  riskTolerance = 0,
  rules = null,
  showDeltaBadge = true,
}) {
  const fair = row?.fair_value ?? row?.model_bid_hint;
  const bid = effectiveAuctionBid(row, riskTolerance, rules);
  const delta = showDeltaBadge ? raavDelta(row, riskTolerance, rules) : null;
  const deltaLabel = formatRaavDelta(delta);
  const tip = deltaLabel
    ? raavDeltaTooltip({
      delta,
      riskTolerance,
      riskScore: row?.risk_score,
    })
    : null;

  return (
    <span className="hub-raav-bid">
      <span className="hub-raav-bid-main">{fmtSal(bid ?? fair)}</span>
      {deltaLabel && (
        <HoverTip
          className="hub-raav-delta-tip"
          content={(
            <>
              <TipTitle>Risk-adjusted bid</TipTitle>
              <TipLine>{tip}</TipLine>
              {row?.risk_score != null && (
                <TipLine className="hover-tip-muted">
                  Risk score {formatRiskScore(row.risk_score)}
                </TipLine>
              )}
            </>
          )}
        >
          <span
            className={`hub-raav-delta${delta > 0 ? " hub-raav-delta--up" : " hub-raav-delta--down"}`}
          >
            {deltaLabel}
          </span>
        </HoverTip>
      )}
    </span>
  );
}

export default memo(RaavBidCell);
