import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import { HubFilterChip, HubFilterScroll, HubPage } from "./HubUILayout";
import HubTabIntro from "./HubTabIntro";
import { getInsightsSection, setInsightsSection } from "./hubDataCache";
import { confirmDialog } from "../ui/confirm";
import { HUB_POS_ORDER, HUB_POSITION_FILTERS, normalizeHubPosition } from "./hubPositions";
import { fmtSal } from "./rosterFormat";
import { clearTradeSeed, readTradeSeed } from "./tradeSeed";
import { formatStatDelta, projectTeamTradeStats } from "./tradeProjection";

const MAX_PARTIES = 4;

function emptyParty(teamId) {
  return { team_id: teamId || "", sends: [], drops: [] };
}

function Chip({ label, tone }) {
  return <span className={`hub-insights-chip hub-insights-chip-${tone}`}>{label}</span>;
}

function gradeLabel(grade) {
  if (grade === "good") return "Good value";
  if (grade === "bad") return "Overpay";
  if (grade === "fair") return "Fair";
  return null;
}

function gradeClass(grade) {
  if (grade === "good") return "hub-value-delta-pos";
  if (grade === "bad") return "hub-value-delta-neg";
  return "";
}

function sortRoster(rows) {
  return [...rows].sort((a, b) => {
    const pa = HUB_POS_ORDER.indexOf(normalizeHubPosition(a.position));
    const pb = HUB_POS_ORDER.indexOf(normalizeHubPosition(b.position));
    const ai = pa >= 0 ? pa : 99;
    const bi = pb >= 0 ? pb : 99;
    if (ai !== bi) return ai - bi;
    return String(a.player_name || "").localeCompare(String(b.player_name || ""));
  });
}

function StatWithDelta({ value, delta, label, warn }) {
  return (
    <span className={warn ? "hub-trade-stat-warn" : undefined}>
      <strong>{fmtSal(value)}</strong> {label}
      {delta && <span className="hub-trade-stat-delta"> ({delta})</span>}
    </span>
  );
}

function TeamCapStrip({ projected, salaryCap }) {
  if (!projected) return null;
  const { committed, dead_cap: dead, unspent, by_position_count: byPos, base, dirty } = projected;
  const basePos = base?.by_position_count || {};
  return (
    <div
      className={`hub-trade-team-stats${dirty ? " is-projected" : ""}`}
      aria-label={dirty ? "Projected post-trade cap" : "Team cap summary"}
    >
      {dirty && <span className="hub-trade-preview-tag">Projected</span>}
      {committed != null && (
        <StatWithDelta
          value={committed}
          label="committed"
          delta={dirty ? formatStatDelta(base?.committed, committed) : null}
        />
      )}
      {(dead > 0 || (dirty && base?.dead_cap > 0)) && (
        <StatWithDelta
          value={dead}
          label="dead"
          delta={dirty ? formatStatDelta(base?.dead_cap, dead) : null}
          warn={dirty && dead > (base?.dead_cap || 0)}
        />
      )}
      {unspent != null && (
        <StatWithDelta
          value={unspent}
          label={salaryCap != null ? `free / ${fmtSal(salaryCap)}` : "free"}
          delta={dirty ? formatStatDelta(base?.unspent, unspent) : null}
          warn={unspent < 0}
        />
      )}
      {HUB_POS_ORDER.filter((pos) => (byPos[pos] || 0) > 0 || (dirty && (basePos[pos] || 0) > 0)).map((pos) => {
        const n = byPos[pos] || 0;
        const bn = basePos[pos] || 0;
        const changed = dirty && n !== bn;
        return (
          <span
            key={pos}
            className={`hub-trade-pos-count${changed ? " is-changed" : ""}${n > bn ? " is-up" : ""}${n < bn ? " is-down" : ""}`}
            title={changed ? `Was ${bn}` : undefined}
          >
            {pos} {n}
            {changed && <span className="hub-trade-pos-delta">{n > bn ? `+${n - bn}` : `${n - bn}`}</span>}
          </span>
        );
      })}
    </div>
  );
}

function TradePlayerRow({
  row,
  media,
  sending,
  dropping,
  canSend,
  onSend,
  onDrop,
}) {
  const grade = gradeLabel(row.contract_grade);
  const yrs = row.years_remaining ?? row.contract_years;
  return (
    <li
      className={[
        "hub-trade-player-row",
        sending ? "is-sending" : "",
        dropping ? "is-dropping" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="hub-trade-player-main">
        <span className="hub-roster-pos-tag hub-trade-pos">{row.position || "—"}</span>
        <div className="hub-trade-player-identity">
          <PlayerCell
            name={row.player_name}
            team={row.team}
            playerId={row.player_id}
            position={row.position}
            media={media}
            size="sm"
            showTeam
            clickable
            narrativeScope="season"
          />
          <div className="hub-trade-player-meta">
            {yrs != null && <span>{yrs}y</span>}
            {row.contract_type && <span>{row.contract_type}</span>}
            {row.expire_chip === "extend" && (
              <span className="hub-sleeper-badge">Extend</span>
            )}
            {row.expire_chip === "fa" && (
              <span className="hub-sleeper-badge">Expires FA</span>
            )}
            {grade && (
              <span className={gradeClass(row.contract_grade)}>
                {grade}
                {row.value_delta != null
                  ? ` (${row.value_delta <= 0 ? "" : "+"}${fmtSal(row.value_delta)})`
                  : ""}
              </span>
            )}
            {row.fp_per_dollar != null && (
              <span className="hub-trade-fpd">{row.fp_per_dollar} fp/$</span>
            )}
          </div>
        </div>
      </div>
      <div className="hub-trade-player-actions">
        <span className="hub-trade-salary">{fmtSal(row.salary)}</span>
        <button
          type="button"
          className={`btn-ghost btn-sm${sending ? " active" : ""}`}
          disabled={!canSend}
          onClick={onSend}
          title={canSend ? "Include in outgoing package" : "Select another team first"}
        >
          Send
        </button>
        <button
          type="button"
          className={`btn-ghost btn-sm${dropping ? " active" : ""}`}
          onClick={onDrop}
          title="Cut for roster space; assign dead cap below"
        >
          Drop
        </button>
      </div>
    </li>
  );
}

export default function LeagueTrades({ leagueId, hubContext }) {
  const [tab, setTab] = useState("builder");
  const [insights, setInsights] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [salaryCap, setSalaryCap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [validationErrors, setValidationErrors] = useState([]);
  const [posFilter, setPosFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const myTeamId = hubContext?.team_id || "";
  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const rules = hubContext?.rules || null;
  const teams = useMemo(
    () => (rosters || []).map((b) => b.team).filter(Boolean),
    [rosters],
  );
  const rosterByTeam = useMemo(() => {
    const m = {};
    (rosters || []).forEach((b) => {
      if (b.team?.id) {
        m[b.team.id] = sortRoster(
          (b.roster || []).filter((r) => String(r.roster_status || "active") === "active"),
        );
      }
    });
    return m;
  }, [rosters]);
  const statsByTeam = useMemo(() => {
    const m = {};
    (rosters || []).forEach((b) => {
      if (b.team?.id) m[b.team.id] = b.stats || {};
    });
    return m;
  }, [rosters]);
  const rowByPlayer = useMemo(() => {
    const m = {};
    Object.values(rosterByTeam).forEach((rows) => {
      rows.forEach((r) => {
        if (r.player_id) m[r.player_id] = r;
      });
    });
    return m;
  }, [rosterByTeam]);

  const [parties, setParties] = useState(() => [
    emptyParty(myTeamId),
    emptyParty(""),
  ]);
  const [deadCapAssignments, setDeadCapAssignments] = useState([]);

  const trade = insights?.trade || {};

  const loadRosters = useCallback(async () => {
    if (!leagueId) return;
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/rosters`);
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    setRosters(data.teams || []);
    if (data.salary_cap != null) setSalaryCap(data.salary_cap);
    return data.teams || [];
  }, [leagueId]);

  const loadProposals = useCallback(async () => {
    if (!leagueId) return;
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades?status=pending`);
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    setProposals(data.proposals || []);
  }, [leagueId]);

  const loadInsights = useCallback(async () => {
    if (!leagueId) return;
    const cached = getInsightsSection(leagueId, "trades", "current");
    if (cached) setInsights(cached);
    const params = new URLSearchParams({ sections: "trades" });
    const res = await apiFetch(
      `/api/hub/league/${encodeURIComponent(leagueId)}/insights?${params}`,
    );
    if (!res.ok) throw new Error(await parseApiError(res));
    const payload = await res.json();
    setInsightsSection(leagueId, "trades", "current", payload);
    setInsights(payload);
  }, [leagueId]);

  const boot = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const teamBlocks = await loadRosters();
      await Promise.all([loadProposals(), loadInsights()]);
      const seed = readTradeSeed();
      if (seed?.players?.length) {
        clearTradeSeed();
        const myId = hubContext?.team_id || myTeamId;
        const otherId = seed.players.find((p) => p.team_id && p.team_id !== myId)?.team_id
          || (teamBlocks || []).map((b) => b.team?.id).find((id) => id && id !== myId)
          || "";
        const next = [
          emptyParty(myId),
          emptyParty(otherId),
        ];
        seed.players.forEach((p) => {
          const fromIdx = next.findIndex((x) => x.team_id === p.team_id);
          const from = fromIdx >= 0 ? next[fromIdx] : next[1];
          if (!from.team_id) from.team_id = p.team_id;
          const toId = from.team_id === myId ? otherId : myId;
          if (toId && !from.sends.some((s) => s.player_id === p.player_id)) {
            from.sends.push({ player_id: p.player_id, to_team_id: toId });
          }
        });
        setParties(next);
        setTab("builder");
      } else if (myTeamId) {
        setParties((prev) => {
          if (prev[0]?.team_id) return prev;
          const copy = prev.map((p) => ({ ...p }));
          copy[0] = { ...copy[0], team_id: myTeamId };
          return copy;
        });
      }
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [loadRosters, loadProposals, loadInsights, hubContext?.team_id, myTeamId]);

  useEffect(() => {
    boot();
  }, [boot]);

  const allPlayerIds = useMemo(() => {
    const ids = new Set();
    parties.forEach((p) => {
      (rosterByTeam[p.team_id] || []).forEach((r) => r.player_id && ids.add(r.player_id));
      p.sends.forEach((s) => s.player_id && ids.add(s.player_id));
      p.drops.forEach((d) => ids.add(d));
    });
    proposals.forEach((prop) => {
      (prop.parties || []).forEach((party) => {
        (party.sends || []).forEach((s) => s.player_id && ids.add(s.player_id));
        (party.drops || []).forEach((d) => ids.add(d));
      });
    });
    (trade.suggestions || []).forEach((s) => {
      (s.send || []).forEach((x) => x.player_id && ids.add(x.player_id));
      (s.receive || []).forEach((x) => x.player_id && ids.add(x.player_id));
    });
    return [...ids];
  }, [parties, rosterByTeam, proposals, trade.suggestions]);
  const media = usePlayerMedia(allPlayerIds);

  const teamName = (tid) => teams.find((t) => t.id === tid)?.name || tid || "—";

  const playerLabel = (tid, pid) => {
    const row = rowByPlayer[pid] || (rosterByTeam[tid] || []).find((r) => r.player_id === pid);
    return row?.player_name || pid;
  };

  const receivingFor = useCallback((teamId) => {
    if (!teamId) return [];
    const incoming = [];
    parties.forEach((p) => {
      if (p.team_id === teamId) return;
      (p.sends || []).forEach((s) => {
        if (s.to_team_id === teamId) {
          incoming.push({
            ...s,
            from_team_id: p.team_id,
            row: rowByPlayer[s.player_id],
          });
        }
      });
    });
    return incoming;
  }, [parties, rowByPlayer]);

  const packageLegs = useMemo(() => {
    const legs = [];
    parties.forEach((p) => {
      (p.sends || []).forEach((s) => {
        const row = rowByPlayer[s.player_id];
        legs.push({
          from: p.team_id,
          to: s.to_team_id,
          player_id: s.player_id,
          name: row?.player_name || s.player_id,
          position: row?.position,
          salary: row?.salary,
        });
      });
      (p.drops || []).forEach((pid) => {
        const row = rowByPlayer[pid];
        legs.push({
          from: p.team_id,
          to: null,
          drop: true,
          player_id: pid,
          name: row?.player_name || pid,
          position: row?.position,
          salary: row?.salary,
        });
      });
    });
    return legs;
  }, [parties, rowByPlayer]);

  const projectedByTeam = useMemo(() => {
    const out = {};
    const cap = salaryCap ?? rules?.salary_cap ?? 200;
    parties.forEach((p) => {
      if (!p.team_id) return;
      out[p.team_id] = projectTeamTradeStats({
        teamId: p.team_id,
        statsByTeam,
        rosterByTeam,
        rowByPlayer,
        parties,
        deadCapAssignments,
        rules,
        salaryCap: cap,
      });
    });
    return out;
  }, [parties, deadCapAssignments, statsByTeam, rosterByTeam, rowByPlayer, rules, salaryCap]);

  const syncDeadCapDefaults = (nextParties) => {
    setDeadCapAssignments((prev) => {
      const next = [];
      nextParties.forEach((p) => {
        (p.drops || []).forEach((pid) => {
          const existing = prev.find(
            (a) => a.player_id === pid && a.from_team_id === p.team_id,
          );
          next.push(
            existing || {
              player_id: pid,
              from_team_id: p.team_id,
              assigned_to_team_id: p.team_id,
            },
          );
        });
      });
      return next;
    });
  };

  const clearValidation = () => {
    setValidationErrors([]);
  };

  const setPartyTeam = (idx, teamId) => {
    clearValidation();
    setParties((prev) => {
      const next = prev.map((p, i) => (i === idx ? { ...p, team_id: teamId, sends: [], drops: [] } : p));
      syncDeadCapDefaults(next);
      return next;
    });
  };

  const toggleSend = (idx, playerId, toTeamId) => {
    clearValidation();
    setParties((prev) => {
      const next = prev.map((p, i) => {
        if (i !== idx) return p;
        const sends = [...p.sends];
        const at = sends.findIndex((s) => s.player_id === playerId);
        if (at >= 0) sends.splice(at, 1);
        else sends.push({ player_id: playerId, to_team_id: toTeamId });
        const drops = p.drops.filter((d) => d !== playerId);
        return { ...p, sends, drops };
      });
      syncDeadCapDefaults(next);
      return next;
    });
  };

  const toggleDrop = (idx, playerId) => {
    clearValidation();
    setParties((prev) => {
      const next = prev.map((p, i) => {
        if (i !== idx) return p;
        const drops = p.drops.includes(playerId)
          ? p.drops.filter((d) => d !== playerId)
          : [...p.drops, playerId];
        const sends = p.sends.filter((s) => s.player_id !== playerId);
        return { ...p, drops, sends };
      });
      syncDeadCapDefaults(next);
      return next;
    });
  };

  const addParty = () => {
    if (parties.length >= MAX_PARTIES) return;
    clearValidation();
    setParties((prev) => [...prev, emptyParty("")]);
  };

  const removeParty = (idx) => {
    if (parties.length <= 2) return;
    clearValidation();
    setParties((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      syncDeadCapDefaults(next);
      return next;
    });
  };

  const buildPayload = () => ({
    parties: parties
      .filter((p) => p.team_id)
      .map((p) => ({
        team_id: p.team_id,
        sends: p.sends,
        drops: p.drops,
      })),
    dead_cap_assignments: deadCapAssignments.filter((a) =>
      parties.some((p) => p.team_id === a.from_team_id && p.drops.includes(a.player_id)),
    ),
  });

  const validate = async () => {
    setBusy("validate");
    setValidationErrors([]);
    setMsg("");
    setError("");
    try {
      const body = { ...buildPayload(), validate_only: true };
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || await parseApiError(res));
      if (data.salary_cap != null) setSalaryCap(data.salary_cap);
      if (data.ok) {
        setMsg("Trade looks valid — cap and roster limits pass.");
        setValidationErrors([]);
      } else {
        setValidationErrors(data.errors || ["Invalid trade"]);
      }
      if (data.dead_cap_assignments) {
        setDeadCapAssignments(data.dead_cap_assignments);
      }
    } catch (e) {
      setValidationErrors([e.message || "Validation failed"]);
    } finally {
      setBusy("");
    }
  };

  const propose = async () => {
    setBusy("propose");
    setError("");
    setMsg("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setMsg("Proposal sent — waiting for acceptances.");
      setTab("inbox");
      await loadProposals();
    } catch (e) {
      setError(e.message || "Could not propose");
    } finally {
      setBusy("");
    }
  };

  const respond = async (proposalId, approve) => {
    setBusy(proposalId);
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(proposalId)}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approve }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMsg(data.proposal?.status === "executed" ? "Trade executed." : approve ? "Accepted." : "Rejected.");
      await loadProposals();
      await loadRosters();
    } catch (e) {
      setError(e.message || "Response failed");
    } finally {
      setBusy("");
    }
  };

  const forceApply = async (proposalId) => {
    if (!(await confirmDialog({
      title: "Force-apply trade",
      message: "Apply this trade without waiting for all accepts?",
      confirmLabel: "Force apply",
      danger: true,
    }))) return;
    setBusy(proposalId);
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(proposalId)}/force`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setMsg("Trade force-applied.");
      await loadProposals();
      await loadRosters();
    } catch (e) {
      setError(e.message || "Force apply failed");
    } finally {
      setBusy("");
    }
  };

  const cancelProp = async (proposalId) => {
    setBusy(proposalId);
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(proposalId)}/cancel`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      await loadProposals();
    } catch (e) {
      setError(e.message || "Cancel failed");
    } finally {
      setBusy("");
    }
  };

  const loadSuggestion = (suggestion) => {
    const partnerId = suggestion.partner_team_id;
    const next = [
      {
        team_id: myTeamId,
        sends: (suggestion.send || []).map((p) => ({
          player_id: p.player_id,
          to_team_id: partnerId,
        })),
        drops: [],
      },
      {
        team_id: partnerId,
        sends: (suggestion.receive || []).map((p) => ({
          player_id: p.player_id,
          to_team_id: myTeamId,
        })),
        drops: [],
      },
    ];
    setParties(next);
    setDeadCapAssignments([]);
    clearValidation();
    setTab("builder");
    setMsg("Loaded package into builder.");
  };

  const otherTeamOptions = (currentId) =>
    teams.filter((t) => t.id === currentId || !parties.some((p) => p.team_id === t.id && p.team_id !== currentId));

  const filterRows = (rows) => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (posFilter !== "ALL" && normalizeHubPosition(r.position) !== posFilter) return false;
      if (!q) return true;
      const hay = `${r.player_name || ""} ${r.team || ""} ${r.position || ""}`.toLowerCase();
      return hay.includes(q);
    });
  };

  const bannerErrors = validationErrors;
  const bannerError = error;

  return (
    <HubPage>
      <HubTabIntro
        title="Trades"
        purpose="Build multi-team packages, assign dead cap on drops, and collect accepts."
      />

      <div className="hub-filter-bar hub-trade-tabs">
        {[
          { id: "builder", label: "Builder" },
          { id: "inbox", label: `Inbox${proposals.length ? ` (${proposals.length})` : ""}` },
          { id: "ideas", label: "Ideas" },
        ].map((t) => (
          <HubFilterChip
            key={t.id}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </HubFilterChip>
        ))}
      </div>

      {(bannerError || bannerErrors.length > 0) && (
        <div className="error hub-trade-alerts" role="alert">
          {bannerError && <div>{bannerError}</div>}
          {bannerErrors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      {msg && <p className="chart-note hub-trade-msg">{msg}</p>}
      {loading && <p className="chart-note">Loading trades…</p>}

      {tab === "builder" && !loading && (
        <div className="hub-trade-builder">
          {packageLegs.length > 0 && (
            <div className="hub-trade-package" aria-label="Package summary">
              <div className="hub-trade-package-title">Package</div>
              <ul className="hub-trade-package-list">
                {packageLegs.map((leg) => (
                  <li key={`${leg.drop ? "drop" : "send"}-${leg.from}-${leg.player_id}`}>
                    <span className="hub-roster-pos-tag">{leg.position || "?"}</span>
                    <strong>{leg.name}</strong>
                    <span className="hub-trade-salary-inline">{fmtSal(leg.salary)}</span>
                    {leg.drop ? (
                      <span className="hub-trade-leg-flow">drop from {teamName(leg.from)}</span>
                    ) : (
                      <span className="hub-trade-leg-flow">
                        {teamName(leg.from)} → {teamName(leg.to)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="hub-trade-filters hub-filter-bar">
            <input
              type="search"
              className="search-input hub-filter-search"
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter roster players"
            />
            <HubFilterScroll className="hub-trade-pos-filters">
              {HUB_POSITION_FILTERS.map((p) => (
                <HubFilterChip
                  key={p}
                  active={posFilter === p}
                  onClick={() => setPosFilter(p)}
                >
                  {p === "ALL" ? "All" : p}
                </HubFilterChip>
              ))}
            </HubFilterScroll>
          </div>

          <div className={`hub-trade-parties hub-trade-parties-${Math.min(parties.length, 4)}`}>
            {parties.map((party, idx) => {
              const others = parties.filter((p, i) => i !== idx && p.team_id).map((p) => p.team_id);
              const defaultTo = others[0] || "";
              const rows = filterRows(rosterByTeam[party.team_id] || []);
              const incoming = receivingFor(party.team_id);
              const teamProjected = party.team_id ? projectedByTeam[party.team_id] : null;
              return (
                <div key={idx} className="hub-trade-party-col panel">
                  <div className="hub-trade-party-head">
                    <select
                      value={party.team_id}
                      onChange={(e) => setPartyTeam(idx, e.target.value)}
                      aria-label={`Party ${idx + 1} team`}
                    >
                      <option value="">Select team…</option>
                      {otherTeamOptions(party.team_id).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}{t.id === myTeamId ? " (you)" : ""}
                        </option>
                      ))}
                    </select>
                    {parties.length > 2 && (
                      <button type="button" className="btn-ghost btn-sm" onClick={() => removeParty(idx)}>
                        Remove
                      </button>
                    )}
                  </div>

                  {party.team_id && (
                    <TeamCapStrip
                      projected={teamProjected}
                      salaryCap={salaryCap ?? rules?.salary_cap}
                    />
                  )}

                  {!party.team_id ? (
                    <p className="chart-note">Pick a team to load roster.</p>
                  ) : (
                    <ul className="hub-trade-player-list">
                      {rows.length === 0 && (
                        <li className="chart-note hub-trade-empty-list">No players match filters.</li>
                      )}
                      {rows.map((r) => {
                        const sending = party.sends.some((s) => s.player_id === r.player_id);
                        const dropping = party.drops.includes(r.player_id);
                        return (
                          <TradePlayerRow
                            key={r.player_id}
                            row={r}
                            media={media}
                            sending={sending}
                            dropping={dropping}
                            canSend={Boolean(defaultTo)}
                            onSend={() => toggleSend(idx, r.player_id, defaultTo)}
                            onDrop={() => toggleDrop(idx, r.player_id)}
                          />
                        );
                      })}
                    </ul>
                  )}

                  {incoming.length > 0 && (
                    <div className="hub-trade-legs hub-trade-receiving">
                      <strong>Receiving</strong>
                      {incoming.map((s) => (
                        <div key={s.player_id} className="hub-trade-leg-row">
                          <span className="hub-roster-pos-tag">{s.row?.position || "?"}</span>
                          <PlayerCell
                            name={s.row?.player_name || s.player_id}
                            team={s.row?.team}
                            playerId={s.player_id}
                            media={media}
                            size="sm"
                            showTeam={false}
                            narrativeScope="season"
                          />
                          <span className="hub-trade-salary-inline">{fmtSal(s.row?.salary)}</span>
                          <span className="table-meta">from {teamName(s.from_team_id)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {party.sends.length > 0 && (
                    <div className="hub-trade-legs">
                      <strong>Sending</strong>
                      {party.sends.map((s) => {
                        const row = rowByPlayer[s.player_id];
                        return (
                          <div key={s.player_id} className="hub-trade-leg-row">
                            <span className="hub-roster-pos-tag">{row?.position || "?"}</span>
                            <span>{playerLabel(party.team_id, s.player_id)}</span>
                            <span className="hub-trade-salary-inline">{fmtSal(row?.salary)}</span>
                            <span className="table-meta">→</span>
                            {parties.length > 2 ? (
                              <select
                                value={s.to_team_id}
                                onChange={(e) => {
                                  clearValidation();
                                  const to = e.target.value;
                                  setParties((prev) => prev.map((p, i) => {
                                    if (i !== idx) return p;
                                    return {
                                      ...p,
                                      sends: p.sends.map((x) =>
                                        x.player_id === s.player_id ? { ...x, to_team_id: to } : x,
                                      ),
                                    };
                                  }));
                                }}
                              >
                                {others.map((oid) => (
                                  <option key={oid} value={oid}>{teamName(oid)}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="table-meta">{teamName(s.to_team_id)}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {party.drops.length > 0 && (
                    <div className="hub-trade-legs">
                      <strong>Drops · dead cap assignee</strong>
                      {party.drops.map((pid) => {
                        const a = deadCapAssignments.find(
                          (x) => x.player_id === pid && x.from_team_id === party.team_id,
                        ) || { assigned_to_team_id: party.team_id };
                        const row = rowByPlayer[pid];
                        return (
                          <div key={pid} className="hub-trade-leg-row hub-trade-drop-row">
                            <span className="hub-roster-pos-tag">{row?.position || "?"}</span>
                            <span>{playerLabel(party.team_id, pid)}</span>
                            <label className="table-meta hub-trade-dead-label">
                              Dead →
                              <select
                                value={a.assigned_to_team_id}
                                onChange={(e) => {
                                  clearValidation();
                                  const assigned = e.target.value;
                                  setDeadCapAssignments((prev) => {
                                    const rest = prev.filter(
                                      (x) => !(x.player_id === pid && x.from_team_id === party.team_id),
                                    );
                                    return [
                                      ...rest,
                                      {
                                        player_id: pid,
                                        from_team_id: party.team_id,
                                        assigned_to_team_id: assigned,
                                      },
                                    ];
                                  });
                                }}
                              >
                                {parties.filter((p) => p.team_id).map((p) => (
                                  <option key={p.team_id} value={p.team_id}>
                                    {teamName(p.team_id)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {a.amount != null && (
                              <span className="hub-trade-stat-warn">{fmtSal(a.amount)}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hub-toolbar hub-trade-builder-actions">
            {parties.length < MAX_PARTIES && (
              <button type="button" className="btn-ghost btn-sm" onClick={addParty}>
                Add team
              </button>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={Boolean(busy)}
              onClick={validate}
            >
              {busy === "validate" ? "Checking…" : "Check constraints"}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={Boolean(busy)}
              onClick={propose}
            >
              {busy === "propose" ? "Sending…" : "Propose trade"}
            </button>
          </div>
        </div>
      )}

      {tab === "inbox" && (
        <div className="hub-trade-inbox">
          {proposals.length === 0 && (
            <div className="hub-insights-empty-state">
              <h3>No pending proposals</h3>
              <p>Build a package and propose it — every team must accept.</p>
            </div>
          )}
          {proposals.map((p) => (
            <div key={p.id} className="hub-insights-suggestion hub-trade-proposal-card">
              <div className="hub-trade-proposal-head">
                <span className={`hub-trade-status hub-trade-status-${p.status}`}>
                  {p.status}
                </span>
                {p.note ? <span className="table-meta">{p.note}</span> : null}
              </div>
              {(p.parties || []).map((party) => (
                <div key={party.team_id} className="hub-trade-proposal-party">
                  <div className="hub-trade-proposal-party-title">
                    <strong>{teamName(party.team_id)}</strong>
                    <span className={`hub-trade-accept hub-trade-accept-${p.acceptances?.[party.team_id] || "pending"}`}>
                      {p.acceptances?.[party.team_id] || "pending"}
                    </span>
                  </div>
                  {(party.sends || []).length > 0 && (
                    <ul className="hub-trade-proposal-legs">
                      {(party.sends || []).map((s) => {
                        const row = rowByPlayer[s.player_id];
                        return (
                          <li key={s.player_id}>
                            <span className="hub-roster-pos-tag">{row?.position || "?"}</span>
                            <PlayerCell
                              name={row?.player_name || s.player_id}
                              team={row?.team}
                              playerId={s.player_id}
                              media={media}
                              size="sm"
                              showTeam={false}
                              narrativeScope="season"
                            />
                            <span className="hub-trade-salary-inline">{fmtSal(row?.salary)}</span>
                            <span className="table-meta">→ {teamName(s.to_team_id)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(party.drops || []).length > 0 && (
                    <p className="table-meta">
                      Drops: {(party.drops || []).map((pid) => playerLabel(party.team_id, pid)).join(", ")}
                    </p>
                  )}
                </div>
              ))}
              <div className="hub-insights-suggestion-actions">
                {p.acceptances?.[myTeamId] === "pending" && (
                  <>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={Boolean(busy)}
                      onClick={() => respond(p.id, true)}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={Boolean(busy)}
                      onClick={() => respond(p.id, false)}
                    >
                      Reject
                    </button>
                  </>
                )}
                {(isCommissioner || (p.parties || []).some((x) => x.team_id === myTeamId)) && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={Boolean(busy)}
                    onClick={() => cancelProp(p.id)}
                  >
                    Cancel
                  </button>
                )}
                {isCommissioner && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={Boolean(busy)}
                    onClick={() => forceApply(p.id)}
                  >
                    Force apply
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "ideas" && (
        <div className="hub-trade-ideas">
          {(trade.balance?.surplus || []).length > 0 && (
            <div className="hub-insights-chips">
              <span className="table-meta">Tradeable depth</span>
              {(trade.balance.surplus || []).map((s) => (
                <Chip key={s} label={`${s} extra`} tone="good" />
              ))}
            </div>
          )}
          {(trade.suggestions || []).length > 0 ? (
            (trade.suggestions || []).map((s, idx) => (
              <div key={`${s.partner_team_id}-${idx}`} className="hub-insights-suggestion">
                <p className="hub-insights-suggestion-rationale">{s.rationale}</p>
                <div className="hub-trade-idea-sides">
                  <div>
                    <span className="table-meta">You send</span>
                    <ul className="hub-trade-proposal-legs">
                      {(s.send || []).map((x) => (
                        <li key={x.player_id}>
                          <span className="hub-roster-pos-tag">{x.position || rowByPlayer[x.player_id]?.position || "?"}</span>
                          <PlayerCell
                            name={x.player_name}
                            playerId={x.player_id}
                            media={media}
                            size="sm"
                            showTeam={false}
                            narrativeScope="season"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="table-meta">You get · {s.partner_team_name || teamName(s.partner_team_id)}</span>
                    <ul className="hub-trade-proposal-legs">
                      {(s.receive || []).map((x) => (
                        <li key={x.player_id}>
                          <span className="hub-roster-pos-tag">{x.position || rowByPlayer[x.player_id]?.position || "?"}</span>
                          <PlayerCell
                            name={x.player_name}
                            playerId={x.player_id}
                            media={media}
                            size="sm"
                            showTeam={false}
                            narrativeScope="season"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => loadSuggestion(s)}
                >
                  Load into builder
                </button>
              </div>
            ))
          ) : (
            <div className="hub-insights-empty-state">
              <h3>No packages yet</h3>
              <p>{trade.empty_reason || "Use the builder to craft a custom trade."}</p>
            </div>
          )}
        </div>
      )}
    </HubPage>
  );
}
