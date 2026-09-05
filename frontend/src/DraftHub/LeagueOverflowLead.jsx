import React, { useEffect, useState } from "react";
import useMobileLayout from "../useMobileLayout";
import { MOBILE_CHROME_COPY } from "../layout/mobileChromePresentation";
import { getFreshnessCache } from "./hubDataCache";
import { ensureLeagueFreshness } from "./leagueFreshness";
import {
  ageShort,
  buildLeagueAttentionItems,
  leagueDisplayName,
  leaguePhaseLabel,
  leagueRoleLabel,
  resolveOverflowAttentionItems,
} from "./leagueAttention";
import { useLeagueChrome } from "./leagueChromeContext";
import { isSoloContext } from "./hubLeagues";

/** Warm the freshness cache while Fantasy is open — the sheet unmounts when closed. */
export function useLeagueFreshness(leagueId, enabled) {
  const [freshness, setFreshness] = useState(
    () => getFreshnessCache(leagueId)?.data || null,
  );

  useEffect(() => {
    if (!leagueId || !enabled) {
      setFreshness(null);
      return undefined;
    }
    const cached = getFreshnessCache(leagueId);
    setFreshness(cached?.data || null);
    const ctrl = new AbortController();
    ensureLeagueFreshness(leagueId)
      .then((payload) => {
        if (!ctrl.signal.aborted && payload) setFreshness(payload);
      })
      .catch(() => {
        /* keep cached */
      });
    return () => ctrl.abort();
  }, [leagueId, enabled]);

  return freshness;
}

export default function LeagueOverflowLead({
  hubContext,
  onNavigate,
  onAfterAction,
}) {
  const { chrome } = useLeagueChrome();
  const mobileLayout = useMobileLayout();
  const leagueId = hubContext?.league_id;
  const inLeague = Boolean(leagueId) && !isSoloContext(hubContext);
  const freshness = useLeagueFreshness(leagueId, inLeague);

  const leagueName = chrome?.leagueName || leagueDisplayName(hubContext, { inLeague });
  const phaseLabel = chrome?.phaseLabel || leaguePhaseLabel(hubContext, { inLeague });
  const roleLabel = chrome?.roleLabel || leagueRoleLabel(hubContext, { inLeague });
  const poolStale = Boolean(freshness?.projections?.stale)
    || (freshness && freshness.projections?.available === false);
  const items = resolveOverflowAttentionItems(
    buildLeagueAttentionItems({
      inLeague,
      poolStale,
      projectionsAvailable: freshness?.projections?.available,
      projAge: ageShort(freshness?.projections?.built_at),
      capSheetsStale: Boolean(freshness?.cap_sheets?.stale),
      isCommish: Boolean(hubContext?.is_commissioner),
    }),
    chrome?.attentionItems,
  );

  if (mobileLayout || !leagueName) return null;

  const runAction = (action) => {
    if (action === "planner") onNavigate?.("planner");
    if (action === "sheets" || action === "projections") onNavigate?.("office");
    onAfterAction?.();
  };

  return (
    <div className="app-mobile-sheet-league">
      <p className="app-mobile-sheet-league-line">
        <strong>{leagueName}</strong>
        {phaseLabel ? ` · ${phaseLabel}` : ""}
        {roleLabel ? ` · ${roleLabel}` : ""}
      </p>
      {items.length > 0 ? (
        <div className="app-mobile-sheet-attention" role="status">
          <p className="app-mobile-sheet-attention-label">{MOBILE_CHROME_COPY.needsAttention}</p>
          <ul className="app-mobile-sheet-attention-list">
            {items.map((item) => (
              <li key={item.id} className="app-mobile-sheet-attention-item">
                <span>{item.label}</span>
                {item.actionLabel ? (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => runAction(item.action)}
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
