import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import HubTabIntro from "./HubTabIntro";
import DraftRecapPanel from "./DraftRecapPanel";

const POS_COLORS = {
  QB: "#6366f1",
  RB: "#22c55e",
  WR: "#f59e0b",
  TE: "#ec4899",
  K: "#a855f7",
  DEF: "#64748b",
};

const DEFAULT_POSITIONS = ["QB", "RB", "WR", "TE"];

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(1)}%`;
}

function playerTradeLabel(p) {
  const sal = p.salary != null ? fmtSal(p.salary) : null;
  const tv = p.trade_value != null ? fmtSal(p.trade_value) : null;
  if (sal && tv && sal !== tv) return `${p.player_name} (${sal} cap · ${tv} value)`;
  return `${p.player_name} (${tv || sal || "—"})`;
}

function Chip({ label, tone }) {
  return <span className={`hub-insights-chip hub-insights-chip-${tone}`}>{label}</span>;
}

function metricValue(team, pos, mode) {
  if (mode === "pct") return team.pct_by_position?.[pos] ?? 0;
  return team.spend_by_position?.[pos] ?? 0;
}

function formatMetric(v, mode) {
  return mode === "pct" ? fmtPct(v) : fmtSal(v);
}

function ScoringEmptyState({ scoring, hubContext, onNavigate, onRefresh }) {
  const reason = scoring?.reason || "unknown";
  const linked = Boolean(
    hubContext?.sleeper_league_id || scoring?.sleeper_league_id,
  );

  let title = "Connect Sleeper for scoring";
  let body = scoring?.hint
    || "Link your Sleeper league on Setup or All teams to pull weekly fantasy points.";

  if (reason === "no_matchups" || (linked && reason !== "fetch_failed")) {
    title = "Waiting for scored games";
    body = scoring?.hint
      || "No scored weeks yet — points appear once your Sleeper league has played games.";
  } else if (reason === "fetch_failed") {
    title = "Could not load Sleeper scoring";
  }

  return (
    <div className="hub-insights-empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {linked && (
        <p className="chart-note hub-insights-empty-meta">
          Sleeper league linked
          {scoring?.season ? ` · ${scoring.season} season` : ""}
          {scoring?.status ? ` · ${scoring.status}` : ""}
        </p>
      )}
      <div className="hub-insights-empty-actions">
        {!linked && onNavigate && (
          <button type="button" className="btn-primary btn-sm" onClick={() => onNavigate("setup")}>
            Go to Setup
          </button>
        )}
        {!linked && onNavigate && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("league-rosters")}>
            All teams
          </button>
        )}
        {onRefresh && (
          <button type="button" className="btn-ghost btn-sm" onClick={onRefresh}>
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

export default function LeagueInsights({ leagueId, hubContext, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teamPick, setTeamPick] = useState("");
  const [expandedPartner, setExpandedPartner] = useState("");
  const [applying, setApplying] = useState("");
  const [msg, setMsg] = useState("");
  const [activeTab, setActiveTab] = useState("cap");
  const [spendMetric, setSpendMetric] = useState("dollars");
  const [visiblePositions, setVisiblePositions] = useState(() => new Set(DEFAULT_POSITIONS));
  const [playerSearch, setPlayerSearch] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");

  const load = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/insights`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setData(payload);
      const positions = payload.analytics?.positions || DEFAULT_POSITIONS;
      setVisiblePositions(new Set(positions));
      const teams = payload.analytics?.teams || [];
      if (!teamPick && teams.length) {
        const mine = teams.find((t) => t.team_id === hubContext?.team_id);
        setTeamPick(mine?.team_id || teams[0].team_id);
      }
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId, hubContext?.team_id]);

  useEffect(() => {
    load();
  }, [load]);

  const positions = useMemo(
    () => data?.analytics?.positions || DEFAULT_POSITIONS,
    [data],
  );

  const activePositions = useMemo(
    () => positions.filter((p) => visiblePositions.has(p)),
    [positions, visiblePositions],
  );

  const barData = useMemo(() => {
    const teams = data?.analytics?.teams || [];
    const mode = spendMetric === "pct" ? "pct" : "dollars";
    return teams.map((t) => {
      const row = { name: t.team_name, unspent: mode === "pct" ? t.pct_unspent : t.unspent };
      for (const p of activePositions) {
        row[p] = metricValue(t, p, mode === "pct" ? "pct" : "dollars");
      }
      return row;
    });
  }, [data, activePositions, spendMetric]);

  const pieData = useMemo(() => {
    const team = (data?.analytics?.teams || []).find((t) => t.team_id === teamPick);
    if (!team) return [];
    const mode = spendMetric === "pct" ? "pct" : "dollars";
    const slices = activePositions.map((p) => ({
      name: p,
      value: metricValue(team, p, mode === "pct" ? "pct" : "dollars"),
      fill: POS_COLORS[p] || "#94a3b8",
    })).filter((s) => s.value > 0);
    const unspent = mode === "pct" ? team.pct_unspent : team.unspent;
    if (unspent > 0) slices.push({ name: "Unspent", value: unspent, fill: "#94a3b8" });
    const dead = mode === "pct" ? team.pct_dead_cap : team.dead_cap;
    if (dead > 0) slices.push({ name: "Dead cap", value: dead, fill: "#ef4444" });
    return slices;
  }, [data, teamPick, activePositions, spendMetric]);

  const scoringLineData = useMemo(() => {
    const weeks = data?.scoring?.weeks || [];
    const teams = new Set();
    weeks.forEach((w) => (w.teams || []).forEach((t) => teams.add(t.team_name)));
    return weeks.map((w) => {
      const row = { week: `W${w.week}` };
      (w.teams || []).forEach((t) => {
        row[t.team_name] = t.points;
      });
      return row;
    });
  }, [data]);

  const scoringTeams = useMemo(() => {
    const names = new Set();
    (data?.scoring?.weeks || []).forEach((w) => (w.teams || []).forEach((t) => names.add(t.team_name)));
    return [...names].slice(0, 8);
  }, [data]);

  const filteredPlayers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    const list = data?.ownership?.players || [];
    if (!q) return list.slice(0, 80);
    return list.filter(
      (p) => String(p.player_name || "").toLowerCase().includes(q)
        || String(p.player_id || "").includes(q),
    ).slice(0, 40);
  }, [data, playerSearch]);

  const selectedPlayer = useMemo(
    () => (data?.ownership?.players || []).find((p) => p.player_id === selectedPlayerId),
    [data, selectedPlayerId],
  );

  const trade = data?.trade || {};
  const balance = trade.balance || {};
  const isCommissioner = Boolean(hubContext?.is_commissioner);

  const togglePosition = (pos) => {
    setVisiblePositions((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) {
        if (next.size > 1) next.delete(pos);
      } else {
        next.add(pos);
      }
      return next;
    });
  };

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
      await load();
    } catch (e) {
      setMsg(connectionErrorMessage(e));
    } finally {
      setApplying("");
    }
  };

  if (loading && !data) {
    return <div className="panel wide"><p className="chart-note">Loading insights…</p></div>;
  }

  const tableMode = spendMetric === "pct" ? "pct" : "dollars";

  return (
    <div className="hub-insights">
      <HubTabIntro
        title="League insights"
        purpose="Compare cap spend, fantasy scoring, and player ownership across your league."
        audience="All league members — trade apply is commissioner-only."
        className="hub-tab-intro-compact"
      />
      {hubContext?.league_name && (
        <p className="chart-note hub-insights-league-meta">
          {hubContext.league_name}
          {hubContext.sleeper_league_id ? " · Sleeper linked" : " · Link Sleeper on Setup for scoring"}
        </p>
      )}

      {data?.draft_recap && (
        <DraftRecapPanel recap={data.draft_recap} />
      )}

      <div className="hub-insights-tabs">
        {[
          { id: "cap", label: "Cap spend" },
          { id: "scoring", label: "Fantasy scoring" },
          { id: "ownership", label: "Player history" },
          { id: "trades", label: "Trade ideas" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`chip chip-filter${activeTab === tab.id ? " chip-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {msg && <p className="chart-note">{msg}</p>}

      {activeTab === "cap" && (
        <section className="panel wide hub-panel">
          <div className="panel-head">
            <h2>Cap spend by team</h2>
            <div className="hub-insights-controls">
              <span className="hub-filter-label">Show as</span>
              <button
                type="button"
                className={`chip chip-filter${spendMetric === "dollars" ? " chip-active" : ""}`}
                onClick={() => setSpendMetric("dollars")}
              >
                Total $
              </button>
              <button
                type="button"
                className={`chip chip-filter${spendMetric === "pct" ? " chip-active" : ""}`}
                onClick={() => setSpendMetric("pct")}
              >
                % of cap
              </button>
            </div>
          </div>

          <div className="hub-insights-pos-filter">
            <span className="hub-filter-label">Positions</span>
            {positions.map((p) => (
              <button
                key={p}
                type="button"
                className={`chip chip-filter${visiblePositions.has(p) ? " chip-active" : ""}`}
                onClick={() => togglePosition(p)}
                style={visiblePositions.has(p) ? { borderColor: POS_COLORS[p] } : undefined}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="hub-insights-grid">
            <div className="hub-insights-chart-panel">
              <h3>Stacked spend</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => (spendMetric === "pct" ? `${v}%` : `$${v}`)}
                  />
                  <Tooltip formatter={(v) => formatMetric(v, tableMode)} />
                  <Legend />
                  {activePositions.map((p) => (
                    <Bar key={p} dataKey={p} stackId="pos" fill={POS_COLORS[p] || "#94a3b8"} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="hub-insights-chart-panel">
              <h3>Team breakdown</h3>
              <select className="search-input" value={teamPick} onChange={(e) => setTeamPick(e.target.value)}>
                {(data?.analytics?.teams || []).map((t) => (
                  <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
                ))}
              </select>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatMetric(v, tableMode)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="table-wrap hub-insights-table-wrap">
            <table className="data-table hub-table">
              <thead>
                <tr>
                  <th>Team</th>
                  {activePositions.map((p) => (
                    <th key={p}>{p} {spendMetric === "pct" ? "%" : "$"}</th>
                  ))}
                  <th>Committed</th>
                  <th>Unspent</th>
                </tr>
              </thead>
              <tbody>
                {(data?.analytics?.teams || []).map((t) => (
                  <tr key={t.team_id}>
                    <td>{t.team_name}</td>
                    {activePositions.map((p) => (
                      <td key={p}>
                        {formatMetric(metricValue(t, p, tableMode), tableMode)}
                        {spendMetric === "dollars" && (
                          <span className="table-meta"> ({t.pct_by_position[p]}%)</span>
                        )}
                      </td>
                    ))}
                    <td>{fmtSal(t.committed)}</td>
                    <td>{fmtSal(t.unspent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "scoring" && (
        <section className="panel wide hub-panel hub-insights-scoring">
          <div className="panel-head">
            <h2>Fantasy scoring (Sleeper)</h2>
            {data?.scoring?.season && (
              <span className="table-meta">{data.scoring.season} season · from linked Sleeper league</span>
            )}
          </div>
          {!data?.scoring?.available && (
            <ScoringEmptyState
              scoring={data?.scoring}
              hubContext={hubContext}
              onNavigate={onNavigate}
              onRefresh={load}
            />
          )}
          {data?.scoring?.available && data?.scoring?.preseason && (
            <p className="chart-note hub-insights-callout">
              {data.scoring.hint
                || "Season hasn't started yet. Standings and the weekly chart will update as games are scored in Sleeper."}
            </p>
          )}
          {data?.scoring?.available && (
            <>
              <div className="hub-insights-scoring-standings">
                {(data.scoring.standings || []).slice(0, 10).map((t, idx) => (
                  <div key={t.team_name} className="hub-insights-standing-card">
                    <span className="hub-insights-standing-rank">#{idx + 1}</span>
                    <strong>{t.team_name}</strong>
                    <span className="chart-note">{t.total_points} pts · {t.avg_points} avg</span>
                  </div>
                ))}
              </div>
              {scoringLineData.length > 0 ? (
                <div className="hub-insights-chart-panel">
                  <h3>Points by week</h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={scoringLineData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {scoringTeams.map((name, i) => (
                        <Line
                          key={name}
                          type="monotone"
                          dataKey={name}
                          stroke={["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#a855f7", "#64748b", "#14b8a6", "#f97316"][i % 8]}
                          dot={false}
                          strokeWidth={2}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="chart-note hub-insights-chart-placeholder">
                  Weekly chart appears after the first scored week in Sleeper.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === "ownership" && (
        <section className="panel wide hub-panel">
          <div className="panel-head">
            <h2>Player ownership history</h2>
            <span className="table-meta">
              Auction wins, cuts, and current contracts · {data?.ownership?.player_count ?? 0} players tracked
            </span>
          </div>
          {filteredPlayers.length === 0 && (
            <p className="chart-note">
              No rostered players yet. Import rosters from Sleeper or a spreadsheet on Setup, or add players on My roster.
            </p>
          )}
          <div className="hub-insights-ownership-layout">
            <div className="hub-insights-ownership-list">
              <input
                type="search"
                className="search-input"
                placeholder="Search player…"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
              />
              <ul className="hub-insights-player-list">
                {filteredPlayers.map((p) => (
                  <li key={p.player_id}>
                    <button
                      type="button"
                      className={`hub-insights-player-btn${selectedPlayerId === p.player_id ? " active" : ""}`}
                      onClick={() => setSelectedPlayerId(p.player_id)}
                    >
                      <span>{p.player_name}</span>
                      <span className="table-meta">{p.position || "—"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hub-insights-ownership-detail">
              {!selectedPlayer && (
                <p className="chart-note">Select a player to see who owned them and at what cost.</p>
              )}
              {selectedPlayer && (
                <>
                  <h3>{selectedPlayer.player_name}</h3>
                  {(selectedPlayer.current_owners || []).length > 0 && (
                    <div className="hub-insights-current-owner">
                      <strong>Current</strong>
                      {(selectedPlayer.current_owners || []).map((o) => (
                        <p key={o.team_id} className="chart-note">
                          {o.team_name}: {fmtSal(o.salary)}/yr · {o.position}
                        </p>
                      ))}
                    </div>
                  )}
                  {(selectedPlayer.timeline || []).length === 0 && (
                    <p className="chart-note">No auction or cut events recorded yet for this player.</p>
                  )}
                  <ol className="hub-insights-timeline">
                    {(selectedPlayer.timeline || []).map((ev, idx) => (
                      <li key={idx}>
                        {ev.event_type === "roster" && (
                          <>
                            <strong>On roster</strong> — {ev.team_name}
                            {ev.amount != null && ev.amount > 0 && ` · ${fmtSal(ev.amount)}/yr`}
                            {ev.note && <span className="table-meta"> · {ev.note}</span>}
                          </>
                        )}
                        {ev.event_type === "acquired" && (
                          <>
                            <strong>Won at auction</strong> — {ev.team_name} for {fmtSal(ev.amount)}
                            {ev.at && <span className="table-meta"> · {new Date(ev.at).toLocaleDateString()}</span>}
                          </>
                        )}
                        {ev.event_type === "cut" && (
                          <>
                            <strong>Dropped</strong> — {ev.team_name}
                            {ev.refund != null && ` · refund ${fmtSal(ev.refund)}`}
                            {ev.at && <span className="table-meta"> · {new Date(ev.at).toLocaleDateString()}</span>}
                          </>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === "trades" && (
        <section className="panel wide hub-panel">
          <div className="panel-head">
            <h2>Trade ideas</h2>
          </div>
          <div className="hub-insights-balance">
            {(balance.need || []).map((p) => (
              <Chip key={`need-${p}`} label={`${p} need`} tone="need" />
            ))}
            {(balance.surplus || []).map((p) => (
              <Chip key={`sur-${p}`} label={`${p} surplus`} tone="surplus" />
            ))}
          </div>

          <div className="hub-insights-partners">
            {(trade.partners || []).map((p) => (
              <div key={p.team_id} className="hub-insights-partner">
                <button
                  type="button"
                  className="hub-insights-partner-head"
                  onClick={() => setExpandedPartner(expandedPartner === p.team_id ? "" : p.team_id)}
                >
                  <strong>{p.team_name}</strong>
                  <span className="table-meta">Fit {p.fit_score} · {fmtSal(p.cap_remaining)} left</span>
                </button>
                {expandedPartner === p.team_id && (
                  <div className="hub-insights-suggestions">
                    {(trade.suggestions || [])
                      .filter((s) => s.partner_team_id === p.team_id)
                      .slice(0, 3)
                      .map((s, idx) => (
                        <div key={idx} className="hub-insights-suggestion">
                          <p>{s.rationale}</p>
                          <p className="table-meta">
                            Send: {s.send.map((x) => playerTradeLabel(x)).join(", ")} ({fmtSal(s.send_total_fair)} value)
                            {" · "}
                            Get: {s.receive.map((x) => playerTradeLabel(x)).join(", ")} ({fmtSal(s.receive_total_fair)} value)
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
                                onClick={() => {
                                  if (window.confirm("Apply this trade for all teams?")) applyTrade(s);
                                }}
                              >
                                Apply trade
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
