import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import { HubPage } from "./HubUILayout";
import { getInsightsSection, setInsightsSection } from "./hubDataCache";
import { confirmDialog } from "../ui/confirm";
import { fmtSal } from "./rosterFormat";

function playerTradeLabel(p) {
  const sal = p.salary != null ? fmtSal(p.salary) : null;
  const tv = p.trade_value != null ? fmtSal(p.trade_value) : null;
  if (sal && tv && sal !== tv) return `${p.player_name} (${sal} cap · ${tv} value)`;
  return `${p.player_name} (${tv || sal || "—"})`;
}

function Chip({ label, tone }) {
  return <span className={`hub-insights-chip hub-insights-chip-${tone}`}>{label}</span>;
}

export default function LeagueTrades({ leagueId, hubContext }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedPartner, setExpandedPartner] = useState("");
  const [applying, setApplying] = useState("");
  const [msg, setMsg] = useState("");

  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const trade = data?.trade || {};
  const balance = trade.balance || {};

  const load = useCallback(async (opts = {}) => {
    if (!leagueId) return;
    const cacheKey = "trades";
    if (!opts.refresh) {
      const cached = getInsightsSection(leagueId, "trades", "current");
      if (cached) {
        setData(cached);
        setLoading(false);
      }
    }
    if (!opts.background) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ sections: "trades" });
      if (opts.refresh) params.set("refresh", "1");
      const root = hubContext?.demo ? "/api/hub/demo" : "/api/hub";
      const res = await apiFetch(
        `${root}/league/${encodeURIComponent(leagueId)}/insights?${params}`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setInsightsSection(leagueId, "trades", "current", payload);
      setData(payload);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId, hubContext?.demo]);

  useEffect(() => {
    load();
  }, [load]);

  const tradePlayerIds = useMemo(() => {
    const ids = new Set();
    (data?.trade?.suggestions || []).forEach((s) => {
      (s.send || []).forEach((p) => p.player_id && ids.add(p.player_id));
      (s.receive || []).forEach((p) => p.player_id && ids.add(p.player_id));
    });
    return [...ids];
  }, [data]);
  const tradeMedia = usePlayerMedia(tradePlayerIds);

  const proposalText = (suggestion) => {
    const partner = (trade.partners || []).find((p) => p.team_id === suggestion.partner_team_id);
    const sendLine = suggestion.send.map((x) => playerTradeLabel(x)).join(", ");
    const recvLine = suggestion.receive.map((x) => playerTradeLabel(x)).join(", ");
    return [
      `Trade proposal with ${partner?.team_name || "partner"}`,
      `Send: ${sendLine} (${fmtSal(suggestion.send_total_fair)} value)`,
      `Get: ${recvLine} (${fmtSal(suggestion.receive_total_fair)} value)`,
      suggestion.rationale || "",
    ].filter(Boolean).join("\n");
  };

  const copyProposal = async (suggestion) => {
    setMsg("");
    try {
      await navigator.clipboard.writeText(proposalText(suggestion));
      setMsg("Trade proposal copied — share with your commissioner or trade partner.");
    } catch {
      setMsg("Could not copy to clipboard.");
    }
  };

  const applyTrade = async (suggestion) => {
    const myId = trade.my_team_id;
    const partnerId = suggestion.partner_team_id;
    const sendA = suggestion.send.map((p) => p.player_id);
    const sendB = suggestion.receive.map((p) => p.player_id);
    setApplying(suggestion.partner_team_id + sendA.join());
    setMsg("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_a_id: myId,
          team_b_id: partnerId,
          send_a: sendA,
          send_b: sendB,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setMsg("Trade applied.");
      await load({ refresh: true, background: true });
    } catch (e) {
      setMsg(connectionErrorMessage(e));
    } finally {
      setApplying("");
    }
  };

  if (loading && !data) {
    return (
      <HubPage>
        <p className="chart-note">Loading trade ideas…</p>
      </HubPage>
    );
  }

  return (
    <HubPage>
      <header className="hub-section-head">
        <h2 className="hub-tab-intro-title">Trades</h2>
        <p className="hub-section-hint">
          Trade ideas from roster gaps and player value.
        </p>
      </header>
      {error && <div className="error">{error}</div>}
      {msg && <p className="chart-note">{msg}</p>}

      <div className="hub-insights-balance">
        {(balance.need || []).length > 0 && (
          <div className="hub-insights-balance-group">
            <span className="hub-filter-label">Roster gaps</span>
            <div className="hub-insights-balance-chips">
              {(balance.need || []).map((p) => (
                <Chip key={`need-${p}`} label={`${p} thin`} tone="need" />
              ))}
            </div>
          </div>
        )}
        {(trade.actionable_needs || []).length > 0 && (
          <div className="hub-insights-balance-group">
            <span className="hub-filter-label">Shoppable needs</span>
            <div className="hub-insights-balance-chips">
              {(trade.actionable_needs || []).map((p) => (
                <Chip key={`act-${p}`} label={`${p} available`} tone="need" />
              ))}
            </div>
          </div>
        )}
        {(balance.surplus || []).length > 0 && (
          <div className="hub-insights-balance-group">
            <span className="hub-filter-label">Tradeable depth</span>
            <div className="hub-insights-balance-chips">
              {(balance.surplus || []).map((p) => (
                <Chip key={`sur-${p}`} label={`${p} extra`} tone="surplus" />
              ))}
            </div>
          </div>
        )}
      </div>

      {(trade.suggestions || []).length > 0 ? (
        <div className="hub-insights-suggestions-primary">
          <h3 className="hub-panel-subtitle">Suggested packages</h3>
          {(trade.suggestions || []).map((s, idx) => {
            const partner = (trade.partners || []).find((p) => p.team_id === s.partner_team_id);
            return (
              <div key={`${s.partner_team_id}-${idx}`} className="hub-insights-suggestion">
                <p className="hub-insights-suggestion-rationale">{s.rationale}</p>
                {(s.fills_needs || []).length > 0 && (
                  <p className="chart-note">
                    Fills: {(s.fills_needs || []).join(", ")}
                    {(s.moves_surplus || []).length > 0 ? ` · Moves: ${(s.moves_surplus || []).join(", ")}` : ""}
                  </p>
                )}
                <p className="table-meta hub-insights-trade-players">
                  <strong>{partner?.team_name || s.partner_team_name || "Partner"}</strong>
                  {" · "}
                  Send:{" "}
                  {s.send.map((x, i) => (
                    <span key={x.player_id || i}>
                      {i > 0 ? ", " : ""}
                      <PlayerCell
                        name={x.player_name}
                        playerId={x.player_id}
                        media={tradeMedia}
                        size="sm"
                        showTeam={false}
                        narrativeScope="season"
                      />
                      {x.salary != null ? ` (${fmtSal(x.salary)})` : ""}
                    </span>
                  ))}
                  {" "}({fmtSal(s.send_total_fair)} value)
                  {" · "}
                  Get:{" "}
                  {s.receive.map((x, i) => (
                    <span key={x.player_id || i}>
                      {i > 0 ? ", " : ""}
                      <PlayerCell
                        name={x.player_name}
                        playerId={x.player_id}
                        media={tradeMedia}
                        size="sm"
                        showTeam={false}
                        narrativeScope="season"
                      />
                      {x.salary != null ? ` (${fmtSal(x.salary)})` : ""}
                    </span>
                  ))}
                  {" "}({fmtSal(s.receive_total_fair)} value)
                </p>
                <div className="hub-insights-suggestion-actions">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => copyProposal(s)}>
                    Copy proposal
                  </button>
                  {isCommissioner && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={Boolean(applying)}
                      onClick={async () => {
                        if (await confirmDialog({
                          title: "Apply trade",
                          message: "Apply this trade for all teams?",
                          confirmLabel: "Apply trade",
                        })) applyTrade(s);
                      }}
                    >
                      Apply trade
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="hub-insights-empty-state">
          <h3>No trade packages yet</h3>
          <p>{trade.empty_reason || "Import rosters and salaries, then check back."}</p>
        </div>
      )}

      {(trade.partners || []).length > 0 && (
        <div className="hub-insights-partners">
          <h3 className="hub-panel-subtitle">Trade partners</h3>
          {(trade.partners || []).map((p) => (
            <div key={p.team_id} className="hub-insights-partner">
              <button
                type="button"
                className="hub-insights-partner-head"
                onClick={() => setExpandedPartner(expandedPartner === p.team_id ? "" : p.team_id)}
              >
                <strong>{p.team_name}</strong>
                <span className="table-meta">
                  Fit {p.fit_score} · {fmtSal(p.cap_remaining)} left
                  {(p.their_surplus || []).length > 0 && ` · surplus ${(p.their_surplus || []).join(", ")}`}
                  {(p.their_need || []).length > 0 && ` · needs ${(p.their_need || []).join(", ")}`}
                </span>
              </button>
              {expandedPartner === p.team_id && (
                <div className="hub-insights-suggestions">
                  {(trade.suggestions || [])
                    .filter((s) => s.partner_team_id === p.team_id)
                    .map((s, idx) => (
                      <div key={idx} className="hub-insights-suggestion hub-insights-suggestion--compact">
                        <p>{s.rationale}</p>
                      </div>
                    ))}
                  {(trade.suggestions || []).filter((s) => s.partner_team_id === p.team_id).length === 0 && (
                    <p className="chart-note">No balanced packages with this team yet.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </HubPage>
  );
}
