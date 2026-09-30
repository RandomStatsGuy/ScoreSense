import { createPortal } from 'react-dom';
import TradeDiscovery from './TradeDiscovery';
import TradeImpactGrid from './TradeImpactGrid';
import { TRADE_DISCOVERY_COPY as DISCOVERY } from './leagueTradesPresentation';
import { currentTradeCap, positionStrengthRanks, projectedTradeImpact } from './tradeOutlook';
import '../styles/league-trades.css';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import {
  HubAlert,
  HubFilterChip,
  HubFilterMenu,
  HubFilterScroll,
  HubLoadingSkeleton,
  HubPage,
} from "./HubUILayout";
import { getInsightsSection, setInsightsSection, loadLeagueRosterRequest } from "./hubDataCache";
import { isAbortError } from "../fetchAbort";
import { loadTradeBootstrap } from "./tradeBootstrap";
import { confirmDialog } from "../ui/confirm";
import { HUB_POS_ORDER, HUB_POSITION_FILTERS, normalizeHubPosition } from "./hubPositions";
import { fmtSal } from "./rosterFormat";
import { leagueUsesSalaries } from "./leagueCapabilities";

import { hubTeamLabel } from "./hubTeamLabel";
import { clearTradeSeed, readTradeSeed, resolveTradePartnerId } from "./tradeSeed";
import { projectTeamTradeStats } from "./tradeProjection";
import { formatIdeaCapNet, ideaCapImpact, whyThisHelpsText } from "./tradeIdeaHelpers";
import { playerTradeableInWindow, tradesWindowBanner } from "./acquisitionWindow";
import { TRADES_COPY, tradesCopyForFormat } from "./leagueTradesPresentation";
import {
  notifyPartnerNames,
  packageFingerprint,
  packageLegFlow,
  sendGetCopy,
  validationBanner,
} from "./tradeBuilderHelpers";
import { projectTradeWeekLineup } from "./tradeWeekPreview";
import {
  TRADE_WEEK_COPY,
  tradeWeekDeltaLine,
  tradeWeekEmptyCopy,
  tradeWeekFaceRows,
  tradeWeekSupport,
  tradeWeekTone,
} from "./tradeWeekPreviewPresentation";

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

function TradeWeekStrip({ preview, emptyCopy, media }) {
  if (!preview) return null;
  if (!preview.available) {
    return (
      <div className="hub-trade-week-strip" aria-label="This Week">
        <div className="hub-trade-week-kicker">{TRADE_WEEK_COPY.eyebrow}</div>
        <p className="chart-note">{emptyCopy || TRADE_WEEK_COPY.missing}</p>
      </div>
    );
  }
  const tone = tradeWeekTone(preview.delta);
  const { shown, overflow } = tradeWeekFaceRows(preview);
  return (
    <div className="hub-trade-week-strip" aria-label="This Week lineup preview">
      <div className="hub-trade-week-kicker">{TRADE_WEEK_COPY.eyebrow}</div>
      <div className={`hub-trade-week-line is-${tone}`}>{tradeWeekDeltaLine(preview)}</div>
      <p className="chart-note">{tradeWeekSupport(preview)}</p>
      {shown.length > 0 && (
        <div className="hub-trade-week-faces">
          {shown.map((row) => (
            <PlayerCell
              key={row.player_id}
              name={row.player_name}
              playerId={row.player_id}
              media={media}
              size="sm"
              showTeam={false}
              narrativeScope="weekly"
            />
          ))}
          {overflow > 0 ? <span className="table-meta">+{overflow}</span> : null}
        </div>
      )}
    </div>
  );
}

function TradeVerdict({ status, errors, message }) {
  const banner = validationBanner(status, errors, message);
  if (!banner) {
    return <div className="hub-trade-verdict-slot" aria-hidden="true" />;
  }
  return (
    <div className="hub-trade-verdict-slot">
      <HubAlert variant={banner.variant} role={banner.role} live={banner.live}>
        {banner.text}
      </HubAlert>
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
  tradeLocked = false,
  isYours,
  destName,
  srcName,
  salaryLeague = true,
  copy = TRADES_COPY,
}) {
  const yrs = row.years_remaining ?? row.contract?.years_remaining ?? row.contract_years;
  const sendCopy=sendGetCopy({isYours,playerName:row.player_name||row.player_id,destName,srcName});
  return <li className={`ss-trade-player-row${sending?' is-sending':''}${dropping?' is-dropping':''}`}>
   <div className="ss-trade-player-name"><PlayerCell name={row.player_name} team={row.team} playerId={row.player_id} position={row.position} media={media} size="sm" showTeam clickable narrativeScope="season"/></div>
   {salaryLeague&&<span className="ss-trade-player-cost">{fmtSal(row.salary)}<small>{yrs??'—'} yrs</small></span>}
   <button type="button" className="ss-trade-square" disabled={!canSend||tradeLocked} onClick={onSend} aria-pressed={sending} aria-label={sendCopy.aria} title={sendCopy.aria}>{sending?'✓':'+'}</button>
  </li>;
}

export default function LeagueTrades({ leagueId, hubContext, onNavigate, cacheScope }) {
  const usesSalaries = leagueUsesSalaries(hubContext);
  const [tab, setTab] = useState("builder");
  const [builderStep, setBuilderStep] = useState("partner");
  const [insights, setInsights] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [salaryCap, setSalaryCap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [secondaryLoading, setSecondaryLoading] = useState(true);
  const [secondaryError, setSecondaryError] = useState({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [validationStatus, setValidationStatus] = useState("idle");
  const [validationErrors, setValidationErrors] = useState([]);
  const [validationMessage, setValidationMessage] = useState("");
  const [proposeNote, setProposeNote] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [partnerSearch, setPartnerSearch] = useState("");
  const [outlook, setOutlook] = useState(null);
  const reviewDialog=useRef(null),reviewTrigger=useRef(null);
  const reviewOpen=tab==='builder'&&builderStep==='review';
  useEffect(()=>{
    const dialog=reviewDialog.current;
    if(!dialog)return;
    if(!reviewOpen){if(dialog.open)dialog.close();return;}
    const previousOverflow=document.body.style.overflow;
    dialog.showModal();document.body.style.overflow='hidden';
    dialog.querySelector('h2')?.focus({preventScroll:true});
    return()=>{if(dialog.open)dialog.close();document.body.style.overflow=previousOverflow;reviewTrigger.current?.focus({preventScroll:true});};
  },[reviewOpen]);
  const validateSeq = useRef(0);
  const payloadRef = useRef(null);

  const myTeamId = hubContext?.team_id || "";
  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const rules = hubContext?.rules || null;
  const salaryLeague = usesSalaries;
  const formatCopy = tradesCopyForFormat(!salaryLeague);
  const acquisitionWindow = hubContext?.acquisition_window || null;
  const tradeBanner = tradesWindowBanner(acquisitionWindow);
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

  const positionRanks=useMemo(()=>positionStrengthRanks(rosterByTeam,rules,outlook?.players),[rosterByTeam,rules,outlook]);
  const rankPositions=useMemo(()=>HUB_POS_ORDER.filter(pos=>Number(rules?.roster?.[pos.toLowerCase()]?.starter)>0||Object.values(rosterByTeam).some(rows=>rows.some(r=>normalizeHubPosition(r.position)===pos))),[rosterByTeam,rules]);
  const [parties, setParties] = useState(() => [
    emptyParty(myTeamId),
    emptyParty(""),
  ]);
  const [deadCapAssignments, setDeadCapAssignments] = useState([]);
  const [weekState, setWeekState] = useState({ status: "idle" });

  const trade = insights?.trade || {};

  const loadRosters = useCallback(async (signal) => {
    if (!leagueId) return;
    const data = await loadLeagueRosterRequest(cacheScope, leagueId, async () => {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/rosters`);
      if (!res.ok) throw new Error(await parseApiError(res));
      return res.json();
    });
    if (signal?.aborted) return;
    setRosters(data.teams || []);
    if (data.salary_cap != null) setSalaryCap(data.salary_cap);
    return data.teams || [];
  }, [leagueId, cacheScope]);

  useEffect(()=>{
    const controller=new AbortController();setOutlook(null);
    if(leagueId)apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trade-outlook`,{signal:controller.signal})
      .then(async res=>{if(!res.ok)throw new Error('Outlook unavailable');return res.json();})
      .then(data=>{if(!controller.signal.aborted)setOutlook(data);})
      .catch(()=>{if(!controller.signal.aborted)setOutlook({players:{}});});
    return()=>controller.abort();
  },[leagueId]);

  const loadProposals = useCallback(async (signal) => {
    if (!leagueId) return;
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades?status=pending`, { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    if (signal?.aborted) return;
    setProposals(data.proposals || []);
  }, [leagueId]);

  const loadInsights = useCallback(async (signal) => {
    if (!leagueId) return;
    const cached = getInsightsSection(leagueId, "trades", "current");
    if (cached) setInsights(cached);
    const params = new URLSearchParams({ sections: "trades" });
    const res = await apiFetch(
      `/api/hub/league/${encodeURIComponent(leagueId)}/insights?${params}`,
      { signal },
    );
    if (!res.ok) throw new Error(await parseApiError(res));
    const payload = await res.json();
    if (signal?.aborted) return;
    setInsightsSection(leagueId, "trades", "current", payload);
    setInsights(payload);
  }, [leagueId]);

  const loadWeekPreview = useCallback(async (signal) => {
    try {
      const res = await apiFetch("/api/hub/week?league_cards=1", { signal });
      if (!res.ok) {
        setWeekState({ status: "missing" });
        return;
      }
      const data = await res.json();
      if (!signal?.aborted) setWeekState({ status: "ready", data });
    } catch {
      if (!signal?.aborted) setWeekState({ status: "missing" });
    }
  }, []);

  const boot = useCallback(async (signal) => {
    setLoading(true);
    setSecondaryLoading(true);
    setSecondaryError({});
    setError("");
    try {
      const results = await loadTradeBootstrap({
        loadRosters: () => loadRosters(signal),
        applyRosters: (teamBlocks) => {
          const seed = readTradeSeed();
          if (seed?.players?.length || seed?.partnerTeamId) {
            clearTradeSeed();
            const myId = hubContext?.team_id || myTeamId;
            const otherId = resolveTradePartnerId(seed, myId, teamBlocks);
            const next = [
              emptyParty(myId),
              emptyParty(otherId),
            ];
            (seed.players || []).forEach((p) => {
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
            setBuilderStep(otherId ? "players" : "partner");
          } else if (myTeamId) {
            setParties((prev) => {
              if (prev[0]?.team_id) return prev;
              const copy = prev.map((p) => ({ ...p }));
              copy[0] = { ...copy[0], team_id: myTeamId };
              return copy;
            });
          }
        },
        onReady: () => setLoading(false),
        secondary: [() => loadProposals(signal), () => loadInsights(signal)],
        signal,
      });
      if (signal.aborted) return;
      setSecondaryError(Object.fromEntries(results.flatMap((result, index) =>
        result.status === "rejected" ? [[index === 0 ? "inbox" : "ideas", connectionErrorMessage(result.reason)]] : [])));
    } catch (e) {
      if (!signal.aborted && !isAbortError(e)) setError(connectionErrorMessage(e));
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setSecondaryLoading(false);
      }
    }
  }, [loadRosters, loadProposals, loadInsights, hubContext?.team_id, myTeamId]);

  useEffect(() => {
    const controller = new AbortController();
    boot(controller.signal);
    return () => controller.abort();
  }, [boot]);

  const needsWeekPreview = tab === "inbox";
  useEffect(() => {
    if (!needsWeekPreview || weekState.status !== "idle") return undefined;
    const controller = new AbortController();
    loadWeekPreview(controller.signal);
    return () => controller.abort();
  }, [needsWeekPreview, weekState.status, loadWeekPreview]);

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

  const teamName = (tid) => hubTeamLabel(teams.find((t) => t.id === tid)) || tid || "—";

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
        statsByTeam: Object.fromEntries(Object.entries(statsByTeam).map(([id,stats])=>[id,{...stats,committed:(rosterByTeam[id]||[]).reduce((sum,row)=>sum+Number(row.salary||0),0),by_position_count:(rosterByTeam[id]||[]).reduce((counts,row)=>{const pos=normalizeHubPosition(row.position);counts[pos]=(counts[pos]||0)+1;return counts;},{})}])),
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

  const pointImpact=useMemo(()=>projectedTradeImpact({rosterByTeam,parties,myTeamId,rules,forecasts:outlook?.players,salaryLeague}),[rosterByTeam,parties,myTeamId,rules,outlook,salaryLeague]);
  const weekPayload = weekState.status === "ready" ? weekState.data : null;
  const weekStripReady = weekState.status === "ready" || weekState.status === "missing";
  const weekEmptyCopy = useMemo(() => tradeWeekEmptyCopy({
    emptyRoster: Boolean(weekPayload?.status?.empty_roster),
    projectionsMissing: weekState.status === "missing"
      || !weekPayload?.meta?.projections_available
      || Boolean(weekPayload?.status?.projections_missing),
    draftCompleted: Boolean(hubContext?.draft_completed),
  }), [weekPayload, weekState.status, hubContext?.draft_completed]);

  const inboxWeekPreview = useCallback((proposal) => projectTradeWeekLineup({
    rosterByTeam,
    parties: proposal?.parties || [],
    myTeamId,
    weekCards: weekPayload?.cards,
    weekStarters: weekPayload?.roster?.starters,
    rules,
    projectionsAvailable: Boolean(weekPayload?.meta?.projections_available),
    emptyRoster: Boolean(weekPayload?.status?.empty_roster),
  }), [rosterByTeam, myTeamId, weekPayload, rules]);

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

  const toggleSend = (idx, playerId, toTeamId) => {
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

  const buildPayload = useCallback(() => ({
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
  }), [parties, deadCapAssignments]);

  const partnerTeamIds = useMemo(
    () => parties.slice(1).map((p) => p.team_id).filter(Boolean),
    [parties],
  );

  const hasPartner = partnerTeamIds.length > 0;
  const hasPackage = packageLegs.length > 0;
  const packageKey = useMemo(
    () => packageFingerprint(parties, deadCapAssignments),
    [parties, deadCapAssignments],
  );
  payloadRef.current = buildPayload;

  useEffect(() => {
    if (!leagueId || !hasPartner || !hasPackage) {
      validateSeq.current += 1;
      setValidationStatus("idle");
      setValidationErrors([]);
      setValidationMessage("");
      return undefined;
    }
    const seq = ++validateSeq.current;
    setValidationStatus("pending");
    setValidationErrors([]);
    const timer = setTimeout(async () => {
      try {
        const body = { ...(payloadRef.current?.() || {}), validate_only: true };
        const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (seq !== validateSeq.current) return;
        if (!res.ok) {
          const detail = typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail)
              ? data.detail.map((d) => d.msg || d.detail || "").filter(Boolean).join(" ")
              : "";
          throw new Error(detail || formatCopy.invalidFallback);
        }
        if (data.salary_cap != null) setSalaryCap(data.salary_cap);
        if (data.ok) {
          setValidationStatus("valid");
          setValidationErrors([]);
          setValidationMessage(formatCopy.valid);
        } else {
          setValidationStatus("invalid");
          setValidationErrors(data.errors || [formatCopy.invalidFallback]);
          setValidationMessage("");
        }
        if (data.dead_cap_assignments?.length) {
          setDeadCapAssignments((prev) => prev.map((a) => {
            const hit = data.dead_cap_assignments.find(
              (x) => x.player_id === a.player_id && x.from_team_id === a.from_team_id,
            );
            return hit?.amount != null ? { ...a, amount: hit.amount } : a;
          }));
        }
      } catch (e) {
        if (seq !== validateSeq.current) return;
        setValidationStatus("invalid");
        setValidationErrors([e.message || formatCopy.invalidFallback]);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [leagueId, hasPartner, hasPackage, packageKey]);

  const propose = async () => {
    if (validationStatus !== "valid" || !hasPackage) return;
    setBusy("propose");
    setError("");
    setMsg("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...buildPayload(),
          note: proposeNote.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setMsg(formatCopy.proposalSent);
      setTab("inbox");
      setBuilderStep("partner");
      setProposeNote("");
      setParties([emptyParty(myTeamId), emptyParty("")]);
      setDeadCapAssignments([]);
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
    setTab("builder");
    setBuilderStep("players");
    setMsg(formatCopy.loadedPackage);
  };

  const activeParties = useMemo(
    () => parties.map((p, idx) => ({ ...p, idx })).filter((p) => p.team_id),
    [parties],
  );

  const togglePartner = (teamId) => {
    if (!teamId || teamId === myTeamId) return;
    setParties((prev) => {
      const mine = {
        ...(prev[0] || emptyParty(myTeamId)),
        team_id: myTeamId || prev[0]?.team_id || "",
      };
      const partners = prev.slice(1).filter((p) => p.team_id && p.team_id !== myTeamId);
      const at = partners.findIndex((p) => p.team_id === teamId);
      let nextPartners;
      if (at >= 0) {
        nextPartners = partners.filter((p) => p.team_id !== teamId);
      } else if (partners.length + 1 >= MAX_PARTIES) {
        return prev;
      } else {
        nextPartners = [...partners, emptyParty(teamId)];
      }
      const next = [mine, ...(nextPartners.length ? nextPartners : [emptyParty("")])];
      syncDeadCapDefaults(next);
      return next;
    });
  };

  const goBuilderStep = (stepId) => {
    setBuilderStep(stepId);
  };

  const filterRows = (rows) => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (posFilter !== "ALL" && normalizeHubPosition(r.position) !== posFilter) return false;
      if (!q) return true;
      const hay = `${r.player_name || ""} ${r.team || ""} ${r.position || ""}`.toLowerCase();
      return hay.includes(q);
    });
  };

  const capLimit = salaryCap ?? rules?.salary_cap;
  const canPropose = validationStatus === "valid" && hasPackage && !busy;
  const partnerNames = notifyPartnerNames(teams, partnerTeamIds, myTeamId);

  const renderPartyPlayerColumns = () => (
    <div className={`hub-trade-parties hub-trade-parties-${Math.min(Math.max(activeParties.length, 2), 4)}`}>
      {activeParties.map((party) => {
        const idx = party.idx;
        const others = parties.filter((p, i) => i !== idx && p.team_id).map((p) => p.team_id);
        const defaultTo = others[0] || "";
        const rows = filterRows(rosterByTeam[party.team_id] || []);
        const incoming = receivingFor(party.team_id);
        const teamProjected = party.team_id ? projectedByTeam[party.team_id] : null;
        const isYours = party.team_id === myTeamId;
        return (
          <div key={idx} className="hub-trade-party-col panel">
            <div className="hub-trade-party-head">
              <strong className="hub-trade-party-name">{isYours?'You send':'You get'}</strong><span className="table-meta">{teamName(party.team_id)}</span>
            </div>

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
                    isYours={isYours}
                    destName={teamName(defaultTo)}
                    srcName={teamName(party.team_id)}
                    salaryLeague={salaryLeague}
                    copy={formatCopy}
                    tradeLocked={!playerTradeableInWindow(r, acquisitionWindow)}
                    onSend={() => toggleSend(idx, r.player_id, defaultTo)}
                    onDrop={() => toggleDrop(idx, r.player_id)}
                  />
                );
              })}
            </ul>

            <details className="ss-trade-advanced"><summary>{DISCOVERY.advanced}</summary>
             <div className="ss-trade-cut-options">{rows.map(row=><button key={row.player_id} type="button" className="btn-ghost ss-trade-action" onClick={()=>toggleDrop(idx,row.player_id)} aria-pressed={party.drops.includes(row.player_id)}>{party.drops.includes(row.player_id)?'Undo ':''}{salaryLeague?'Cut':'Drop'} {row.player_name}</button>)}</div>
            {incoming.length > 0 && (
              <div className="hub-trade-legs hub-trade-receiving">
                <strong>{formatCopy.getVerb}</strong>
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
                    {salaryLeague && <span className="hub-trade-salary-inline">{fmtSal(s.row?.salary)}</span>}
                    <span className="table-meta">from {teamName(s.from_team_id)}</span>
                  </div>
                ))}
              </div>
            )}

            {party.sends.length > 0 && (
              <div className="hub-trade-legs">
                <strong>{formatCopy.sendVerb}</strong>
                {party.sends.map((s) => {
                  const row = rowByPlayer[s.player_id];
                  return (
                    <div key={s.player_id} className="hub-trade-leg-row">
                      <span className="hub-roster-pos-tag">{row?.position || "?"}</span>
                      <span>{playerLabel(party.team_id, s.player_id)}</span>
                      {salaryLeague && <span className="hub-trade-salary-inline">{fmtSal(row?.salary)}</span>}
                      <span className="table-meta">→</span>
                      {activeParties.length > 2 ? (
                        <HubFilterMenu
                          label="To"
                          value={s.to_team_id}
                          options={others.map((oid) => ({ id: oid, label: teamName(oid) }))}
                          onChange={(to) => {
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
                        />
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
                <strong>{salaryLeague ? `${formatCopy.cutVerb} · dead cap assignee` : formatCopy.cutVerb}</strong>
                {party.drops.map((pid) => {
                  const a = deadCapAssignments.find(
                    (x) => x.player_id === pid && x.from_team_id === party.team_id,
                  ) || { assigned_to_team_id: party.team_id };
                  const row = rowByPlayer[pid];
                  return (
                    <div key={pid} className="hub-trade-leg-row hub-trade-drop-row">
                      <span className="hub-roster-pos-tag">{row?.position || "?"}</span>
                      <span>{playerLabel(party.team_id, pid)}</span>
                      {salaryLeague && <HubFilterMenu
                        label="Dead →"
                        value={a.assigned_to_team_id}
                        options={activeParties.map((p) => ({
                          id: p.team_id,
                          label: teamName(p.team_id),
                        }))}
                        onChange={(assigned) => {
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
                      />}
                      {salaryLeague && a.amount != null && (
                        <span className="hub-trade-stat-warn">{fmtSal(a.amount)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            </details>
          </div>
        );
      })}
    </div>
  );

  const renderPackageSummary = () => (
    <div className="hub-trade-package" aria-label="Package summary">
      <div className="hub-trade-package-title">{formatCopy.packageTitle}</div>
      {packageLegs.length > 0 ? (
        <ul className="hub-trade-package-list">
          {packageLegs.map((leg) => (
            <li key={`${leg.drop ? "cut" : "send"}-${leg.from}-${leg.player_id}`}>
              <span className="hub-roster-pos-tag">{leg.position || "?"}</span>
              <strong>{leg.name}</strong>
              {salaryLeague && <span className="hub-trade-salary-inline">{fmtSal(leg.salary)}</span>}
              <span className="hub-trade-leg-flow">{packageLegFlow(leg, teamName, formatCopy.cutVerb)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="chart-note">{formatCopy.noPackageYet}</p>
      )}
    </div>
  );

  const renderCapReview = () => (
    <div className="ss-trade-cap-review" aria-label={salaryLeague ? "Cap impact" : "Roster impact"}>
      {activeParties.map(party=>{
        const projected=projectedByTeam[party.team_id];
        if(!projected)return null;
        return <div className="ss-trade-cap-line" key={party.team_id}><span>{party.team_id===myTeamId?'Your':teamName(party.team_id)} {salaryLeague?'Available Cap':'players'}</span><strong>{salaryLeague?`${fmtSal(projected.base.unspent)} → ${fmtSal(projected.unspent)}`:`${Object.values(projected.base.by_position_count).reduce((a,b)=>a+b,0)} → ${Object.values(projected.by_position_count).reduce((a,b)=>a+b,0)}`}</strong></div>;
      })}
    </div>
  );

  const renderStepActions = ({ back, primary, showVerdict = false }) => (
    <div className="hub-toolbar hub-trade-builder-actions">
      {back}
      {showVerdict ? (
        <TradeVerdict
          status={validationStatus}
          errors={validationErrors}
          message={validationMessage}
        />
      ) : null}
      {primary}
    </div>
  );

  return (
    <HubPage className="ss-trades-page" frameless>
      <header className="ss-trade-page-head"><h1>{tab==='builder'?(builderStep==='partner'?DISCOVERY.title:'Trades'):tab==='inbox'?'Inbox':'Trade ideas'}</h1><div className="ss-trade-page-links"><button type="button" className="btn-ghost ss-trade-action" onClick={()=>{setTab('builder');setBuilderStep('partner');}}>Teams</button><button type="button" className="btn-ghost ss-trade-action" onClick={()=>setTab('inbox')}>Inbox{proposals.length?` · ${proposals.length}`:''}</button><button type="button" className="btn-ghost ss-trade-action" onClick={()=>setTab('ideas')}>Ideas</button></div></header>
      {tradeBanner&&<HubAlert variant={tradeBanner.variant}><strong>{tradeBanner.label}.</strong> {tradeBanner.text}</HubAlert>}
      {error && (
        <div className="error hub-trade-alerts" role="alert">
          {error}
        </div>
      )}
      {msg && tab !== "builder" && (
        <HubAlert variant="ready">{msg}</HubAlert>
      )}
      {loading && <HubLoadingSkeleton label="Loading trades" rows={4} />}
      {tab !== "builder" && secondaryLoading && <HubLoadingSkeleton label={TRADES_COPY.loadingDetails} rows={4} />}
      {tab !== "builder" && secondaryError[tab] && <HubAlert variant="warn">{secondaryError[tab]}</HubAlert>}

      {tab==='builder'&&!loading&&!error&&<div className="ss-trade-builder" id="trades-panel-builder">
       {builderStep==='partner'?<>
        {teams.filter(t=>t.id!==myTeamId).length?<TradeDiscovery teams={teams} myTeamId={myTeamId} rosterByTeam={rosterByTeam} statsByTeam={statsByTeam} salaryCap={capLimit} salaryLeague={salaryLeague} ranks={positionRanks} positions={rankPositions} search={partnerSearch} onSearch={setPartnerSearch} onChoose={id=>{setParties([emptyParty(myTeamId),emptyParty(id)]);setDeadCapAssignments([]);setSearch('');setBuilderStep('players');}}/>:<div className="hub-insights-empty-state"><p>{formatCopy.noPartners}</p><button type="button" className="btn-primary" onClick={()=>onNavigate?.('office-members')}>{formatCopy.inviteManagers}</button></div>}
       </>:<>
        <nav className="ss-trade-progress" aria-label="Trade progress"><button type="button" className="btn-ghost ss-trade-action" onClick={()=>goBuilderStep('partner')}>Partner</button><span aria-hidden="true">→</span><span aria-current="step">Players</span><span aria-hidden="true">→</span><span>Review</span></nav>
        <div className="ss-trade-chosen"><strong>{partnerNames.join(' · ')}</strong><button type="button" className="btn-ghost ss-trade-action" onClick={()=>goBuilderStep('partner')}>{DISCOVERY.back}</button></div>
        <div className="hub-trade-filters hub-filter-bar"><input type="search" className="search-input hub-filter-search" placeholder="Find a player" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Filter both rosters"/><HubFilterScroll>{HUB_POSITION_FILTERS.map(p=><HubFilterChip key={p} active={posFilter===p} onClick={()=>setPosFilter(p)}>{p==='ALL'?'All':p}</HubFilterChip>)}</HubFilterScroll></div>
        <TradeImpactGrid impact={pointImpact} salaryLeague={salaryLeague}/>
        {renderPartyPlayerColumns()}
        <details className="ss-trade-advanced"><summary>Multi-team trade</summary><div className="ss-trade-cut-options">{teams.filter(t=>t.id!==myTeamId).map(team=><button type="button" className="btn-ghost ss-trade-action" key={team.id} aria-pressed={partnerTeamIds.includes(team.id)} onClick={()=>togglePartner(team.id)}>{partnerTeamIds.includes(team.id)?'Remove':'Add'} {teamName(team.id)}</button>)}</div></details>
        {!reviewOpen&&renderStepActions({showVerdict:hasPackage,primary:<button type="button" ref={reviewTrigger} className="btn-primary hub-trade-primary" disabled={!hasPackage||!hasPartner} onClick={()=>goBuilderStep('review')}>{DISCOVERY.review} →</button>})}
       </>}
      </div>}
      {createPortal(<dialog className="ss-trade-review" ref={reviewDialog} aria-labelledby="trade-review-title" onCancel={event=>{event.preventDefault();setBuilderStep('players');}}><header><h2 id="trade-review-title" tabIndex={-1}>{DISCOVERY.review}</h2><button type="button" className="btn-ghost ss-trade-action" aria-label={DISCOVERY.close} onClick={()=>setBuilderStep('players')}>×</button></header><div className="ss-trade-review-body">
       {renderPackageSummary()}<TradeImpactGrid impact={pointImpact} salaryLeague={salaryLeague}/>{renderCapReview()}
       {error&&<HubAlert variant="warn">{error}</HubAlert>}
       <TradeVerdict status={validationStatus} errors={validationErrors} message={validationMessage}/>
       <details className="ss-trade-advanced"><summary>{DISCOVERY.note}</summary><textarea aria-label={formatCopy.proposeNoteLabel} value={proposeNote} onChange={e=>setProposeNote(e.target.value)} className="hub-trade-note" rows={3}/></details>
       <details className="ss-trade-advanced"><summary>{DISCOVERY.projectionDetails}</summary><p className="chart-note">{salaryLeague?DISCOVERY.method:DISCOVERY.rosterMethod}</p></details>
       <button type="button" className="btn-primary" disabled={!canPropose||!hasPartner} onClick={propose}>{busy==='propose'?formatCopy.proposing:formatCopy.proposeTrade} →</button><p className="chart-note">{DISCOVERY.afterAccept}</p>
      </div></dialog>,document.body)}

      {tab === "inbox" && !secondaryLoading && !secondaryError.inbox && (
        <div className="hub-trade-inbox" id="trades-panel-inbox">
          {proposals.length === 0 && (
            <div className="hub-insights-empty-state">
              <h3>{formatCopy.inboxEmptyHeading}</h3>
              <p>{formatCopy.inboxEmpty}</p>
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
                            {salaryLeague && <span className="hub-trade-salary-inline">{fmtSal(row?.salary)}</span>}
                            <span className="table-meta">→ {teamName(s.to_team_id)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(party.drops || []).length > 0 && (
                    <p className="table-meta">
                      {formatCopy.cutVerb}: {(party.drops || []).map((pid) => playerLabel(party.team_id, pid)).join(", ")}
                    </p>
                  )}
                </div>
              ))}
              {weekStripReady && p.acceptances?.[myTeamId] === "pending" && (
                <TradeWeekStrip
                  preview={inboxWeekPreview(p)}
                  emptyCopy={weekEmptyCopy}
                  media={media}
                />
              )}
              <div className="hub-insights-suggestion-actions">
                {p.acceptances?.[myTeamId] === "pending" && (
                  <>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
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

      {tab === "ideas" && !secondaryLoading && !secondaryError.ideas && (
        <div className="hub-trade-ideas" id="trades-panel-ideas">
          <p className="chart-note hub-trade-ideas-blurb">{formatCopy.ideasBlurb}</p>
          {((trade.balance?.surplus || []).length > 0 || (trade.balance?.need || []).length > 0) && (
            <div className="hub-insights-chips hub-trade-ideas-balance">
              {(trade.balance?.surplus || []).length > 0 && (
                <div className="hub-insights-balance-group">
                  <span className="table-meta">{formatCopy.ideasSurplus}</span>
                  <div className="hub-insights-balance-chips">
                    {(trade.balance.surplus || []).map((s) => (
                      <Chip key={`surplus-${s}`} label={`${s} extra`} tone="surplus" />
                    ))}
                  </div>
                </div>
              )}
              {(trade.balance?.need || []).length > 0 && (
                <div className="hub-insights-balance-group">
                  <span className="table-meta">{formatCopy.ideasNeeds}</span>
                  <div className="hub-insights-balance-chips">
                    {(trade.balance.need || []).map((n) => (
                      <Chip key={`need-${n}`} label={`${n} thin`} tone="need" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {(trade.suggestions || []).length > 0 ? (
            (trade.suggestions || []).map((s, idx) => {
              const cap = ideaCapImpact(s, rowByPlayer);
              const netFmt = formatIdeaCapNet(cap.net);
              const fills = (s.fills_needs || []).filter(Boolean);
              const moves = (s.moves_surplus || []).filter(Boolean);
              return (
                <div
                  key={`${s.partner_team_id}-${idx}`}
                  className="hub-insights-suggestion hub-trade-idea-card"
                >
                  <div className="hub-trade-idea-why" aria-label="Why this helps">
                    <span className="table-meta">Why this helps</span>
                    <p className="hub-trade-idea-why-text">{whyThisHelpsText(s)}</p>
                    {(fills.length > 0 || moves.length > 0) && (
                      <div className="hub-trade-idea-why-chips">
                        {fills.map((pos) => (
                          <Chip key={`fill-${pos}`} label={`Need ${pos}`} tone="need" />
                        ))}
                        {moves.map((pos) => (
                          <Chip key={`move-${pos}`} label={`Surplus ${pos}`} tone="surplus" />
                        ))}
                      </div>
                    )}
                  </div>
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
                            {salaryLeague && <span className="hub-trade-salary-inline">
                              {fmtSal(x.salary ?? rowByPlayer[x.player_id]?.salary)}
                            </span>}
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
                            {salaryLeague && <span className="hub-trade-salary-inline">
                              {fmtSal(x.salary ?? rowByPlayer[x.player_id]?.salary)}
                            </span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {salaryLeague && <div className="hub-trade-idea-cap" aria-label="Cap impact">
                    <span className="table-meta">Cap impact</span>
                    <p className="hub-trade-idea-cap-line">
                      Send {fmtSal(cap.sendSal)}
                      <span className="hub-trade-idea-cap-sep">·</span>
                      Get {fmtSal(cap.recvSal)}
                      <span className="hub-trade-idea-cap-sep">·</span>
                      <span className={netFmt.tone || undefined}>{netFmt.text}</span>
                    </p>
                  </div>}
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => loadSuggestion(s)}
                  >
                    Load into builder
                  </button>
                </div>
              );
            })
          ) : (
            <div className="hub-insights-empty-state">
              <h3>{formatCopy.ideasEmptyHeading}</h3>
              <p>{trade.empty_reason || "Use the builder to craft a custom trade."}</p>
            </div>
          )}
        </div>
      )}
    </HubPage>
  );
}
