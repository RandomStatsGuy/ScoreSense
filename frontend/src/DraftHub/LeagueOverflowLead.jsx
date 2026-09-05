import React from "react";
import { MOBILE_CHROME_COPY } from "../layout/mobileChromePresentation";
import { useLeagueChrome } from "./leagueChromeContext";

export default function LeagueOverflowLead({ onAfterAction }) {
  const { chrome } = useLeagueChrome();
  if (!chrome?.leagueName) return null;
  const items = chrome.attentionItems || [];
  return (
    <div className="app-mobile-sheet-league">
      <p className="app-mobile-sheet-league-line">
        <strong>{chrome.leagueName}</strong>
        {chrome.phaseLabel ? ` · ${chrome.phaseLabel}` : ""}
        {chrome.roleLabel ? ` · ${chrome.roleLabel}` : ""}
      </p>
      {items.length > 0 ? (
        <div className="app-mobile-sheet-attention" role="status">
          <p className="app-mobile-sheet-attention-label">{MOBILE_CHROME_COPY.needsAttention}</p>
          <ul className="app-mobile-sheet-attention-list">
            {items.map((item) => (
              <li key={item.id} className="app-mobile-sheet-attention-item">
                <span>{item.label}</span>
                {item.onAction && item.actionLabel ? (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => {
                      item.onAction();
                      onAfterAction?.();
                    }}
                  >
                    {item.actionLabel}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
