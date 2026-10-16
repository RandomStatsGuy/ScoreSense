import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useModalFocus from "../ui/useModalFocus";
import "../styles/trade-desk.css";
import "../styles/league-trades.css";
import TradeDiscovery from "./TradeDiscovery";
import TradeImpactGrid from "./TradeImpactGrid";
import { positionStrengthRanks, projectedTradeImpact, currentTradeCap } from "./tradeOutlook";
import { TRADE_DISCOVERY_COPY, tradeForecastStatus } from "./leagueTradesPresentation";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import {
  HubAlert,
  HubExperienceHero,
  HubFilterMenu,
  HubLoadingSkeleton,
  HubPage,
  HubSegmentNav,
} from "./HubUILayout";
import { getInsightsSection, setInsightsSection, loadLeagueRosterRequest, invalidateInsightsAfterCapSync, getWeeklySnapshot, setWeeklySnapshot, weeklySnapshotKey, invalidateWeeklySnapshot } from "./hubDataCache";
import { isAbortError } from "../fetchAbort";
import { loadTradeBootstrap } from "./tradeBootstrap";
import { confirmDialog } from "../ui/confirm";
import { HUB_POS_ORDER, HUB_POSITION_FILTERS, normalizeHubPosition } from "./hubPositions";
import { contractTypeLabel, fmtSal } from "./rosterFormat";
import { hubTeamLabel } from "./hubTeamLabel";
import { clearTradeSeed, readTradeSeed, resolveTradePartnerId } from "./tradeSeed";
import { formatStatDelta, projectTeamTradeStats } from "./tradeProjection";
import { formatIdeaCapNet, ideaCapImpact, whyThisHelpsText } from "./tradeIdeaHelpers";
import { playerTradeableInWindow, tradesWindowBanner } from "./acquisitionWindow";
import { expireChipLabel, TRADES_COPY, tradesCopyForFormat, tradesFreeLabel } from "./leagueTradesPresentation";
import { leagueUsesSalaries } from "./leagueCapabilities";
import {
  packageFingerprint,
  packageLegFlow,
  partnerCardMeta,
  sendGetCopy,
  retainTradeRecipients,
  validationBanner,
} from "./tradeBuilderHelpers";
import { indexWeekCards, projectTradeWeekLineup, tradeWeekPlayerPoints } from "./tradeWeekPreview";
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
  return { team_id: teamId || "", sends: [], drops: [], dead_cap_transfers: [] };
}

function TradeDeskDialog({ title, children, onClose }) {
  const ref = useRef(null);
  useModalFocus(true, ref, onClose);
  return createPortal(
    <div className="hub-trade-dialog-backdrop" onClick={onClose}>
      <section ref={ref} className="hub-trade-dialog" role="dialog" aria-modal="true" aria-label={title}
        onClick={event => event.stopPropagation()} tabIndex={-1}>
        <header><h2>{title}</h2><button type="button" className="btn-ghost" onClick={onClose} aria-label={TRADES_COPY.close}>×</button></header>
        {children}
      </section>
    </div>, document.body,
  );
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

function TeamCapStrip({ projected, salaryCap, salaryLeague = true }) {
  if (!projected) return null;
  const { committed, dead_cap: dead, unspent, by_position_count: byPos, base, dirty } = projected;
  const basePos = base?.by_position_count || {};
  return (
    <div
      className={`hub-trade-team-stats${dirty ? " is-projected" : ""}`}
      aria-label={dirty
        ? "Projected post-trade current roster"
        : (salaryLeague ? "Current roster salary" : "Current roster balance")}
    >
      {dirty && <span className="hub-trade-preview-tag">Projected</span>}
      {!salaryLeague && (
        <span><strong>{Object.values(byPos).reduce((sum, n) => sum + Number(n || 0), 0)}</strong> players</span>
      )}
      {salaryLeague && committed != null && (
        <StatWithDelta
          value={committed}
          label={TRADES_COPY.currentRoster}
          delta={dirty ? formatStatDelta(base?.committed, committed) : null}
        />
      )}
      {salaryLeague && (dead > 0 || (dirty && base?.dead_cap > 0)) && (
        <StatWithDelta
          value={dead}
          label={TRADES_COPY.dead}
          delta={dirty ? formatStatDelta(base?.dead_cap, dead) : null}
          warn={dirty && dead > (base?.dead_cap || 0)}
        />
      )}
      {salaryLeague && unspent != null && (
        <StatWithDelta
          value={unspent}
          label={tradesFreeLabel(salaryCap, fmtSal)}
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
  canDrop = true,
  onSend,
  onDrop,
  tradeLocked = false,
  isYours,
  destName,
  srcName,
  multiTeam = false,
  recipientId = "",
  recipientOptions = [],
  onRecipientChange,
  salaryLeague = true,
  copy = TRADES_COPY,
  advanced = false,
  weekP50 = null,
}) {
  const grade = gradeLabel(row.contract_grade);
  const expireLabel = expireChipLabel(row.expire_chip);
  const yrs = row.years_remaining ?? row.contract?.years_remaining ?? row.contract_years;
  const sendCopy = sendGetCopy({
    isYours,
    playerName: row.player_name || row.player_id,
    destName,
    srcName,
    multiTeam,
  });
  const cutLabel = salaryLeague
    ? copy.cutPlayer(row.player_name || row.player_id)
    : `Drop ${row.player_name || row.player_id} for roster space`;
  return (
    <li
      className={[
        "hub-trade-player-row",
        sending ? "is-sending" : "",
        dropping ? "is-dropping" : "",
        multiTeam ? "has-recipient" : "",
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
            {salaryLeague && yrs != null && <span>{yrs}y</span>}
            {salaryLeague && <span>{contractTypeLabel(row.contract_type || row.contract?.contract_type)}</span>}
            {salaryLeague && advanced && expireLabel && (
              <span className={`hub-expire-chip${row.expire_chip === "extend" ? " hub-expire-chip--extend" : ""}`}>
                {expireLabel}
              </span>
            )}
            {salaryLeague && advanced && grade && (
              <span className={gradeClass(row.contract_grade)}>
                {grade}
                {row.value_delta != null
                  ? ` (${row.value_delta <= 0 ? "" : "+"}${fmtSal(row.value_delta)})`
                  : ""}
              </span>
            )}
            {salaryLeague && advanced && row.fp_per_dollar != null && (
              <span className="hub-trade-fpd">
                {row.fp_per_dollar} pts /$
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="hub-trade-player-actions">
        {multiTeam && <HubFilterMenu
          label="To"
          ariaLabel={copy.recipientFor(row.player_name || row.player_id)}
          value={recipientId}
          options={[{ id: "", label: copy.chooseRecipient }, ...recipientOptions]}
          onChange={onRecipientChange}
          disabled={tradeLocked}
        />}
        <span className="hub-trade-player-numbers"><strong>{weekP50 == null ? "—" : weekP50.toFixed(1)}</strong>
          {salaryLeague && <span className="hub-trade-salary">{fmtSal(row.salary)}</span>}
        </span>
        <button
          type="button"
          className={`btn-ghost btn-sm${sending ? " active" : ""}`}
          disabled={!canSend || tradeLocked}
          onClick={onSend}
          aria-pressed={sending}
          aria-label={sendCopy.aria}
          title={
            tradeLocked
              ? (salaryLeague
                ? "Offseason trades are limited to contracts that continue beyond the upcoming draft"
                : "This player cannot be traded during the current acquisition window")
              : canSend ? sendCopy.aria : "Select another team first"
          }
        >
          <span aria-hidden="true">{sending ? "✓" : "+"}</span>
        </button>
        {((advanced && canDrop) || dropping) && <button
          type="button"
          className={`btn-ghost btn-sm hub-trade-cut-btn${dropping ? " active" : ""}`}
          disabled={!canDrop}
          onClick={onDrop}
          aria-pressed={dropping}
          aria-label={cutLabel}
          title={canDrop ? copy.cutHint : copy.sleeperSupport}
        >
          {copy.cutVerb}
        </button>}
      </div>
    </li>
  );
}

export default function LeagueTrades({ leagueId, hubContext, onNavigate, cacheScope, onChanged, revisionToken = 0 }) {
  const [tab, setTab] = useState("builder");
  const [builderStep, setBuilderStep] = useState("players");
  const [phoneView, setPhoneView] = useState("send");
  const [dialog, setDialog] = useState(null);
  const [multiPartner, setMultiPartner] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState({});
  const reviewRef = useRef(null);
  const builderSearchRef = useRef(null);
  const pendingBuilderFocus = useRef(false);
  const deskBarRef = useRef(null);
  const [loadedLeague, setLoadedLeague] = useState(null);
  const secondaryLoaded = useRef({});
  const [insights, setInsights] = useState(null);
  const [outlook, setOutlook] = useState(null);
  const outlookSnapshot = useRef(null);
  const [proposals, setProposals] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [salaryCap, setSalaryCap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [secondaryStatus, setSecondaryStatus] = useState({});
  const secondaryLoading = ["inbox", "ideas"].includes(tab) && secondaryStatus[tab] !== "ready" && secondaryStatus[tab] !== "error";
  const [secondaryError, setSecondaryError] = useState({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [validationStatus, setValidationStatus] = useState("idle");
  const [validationErrors, setValidationErrors] = useState([]);
  const [validationMessage, setValidationMessage] = useState("");
  const [validatedPackage, setValidatedPackage] = useState(null);
  const [proposeNote, setProposeNote] = useState("");
  const [sourceReviewId, setSourceReviewId] = useState(null);
  const [posFilter, setPosFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const validateSeq = useRef(0);
  const payloadRef = useRef(null);

  const myTeamId = hubContext?.team_id || "";
  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const rules = hubContext?.rules || null;
  const salaryLeague = leagueUsesSalaries(hubContext);
  const sleeperLinked = Boolean(hubContext?.sleeper_league_id);
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
  // Trades uses the full active roster, including expiring deals.
  const statsByTeam = useMemo(() => Object.fromEntries(rosters.filter(b => b.team?.id).map(b => {
    const rows = rosterByTeam[b.team.id] || [];
    const stats = b.stats || {};
    return [b.team.id, {
      ...stats,
      committed: rows.reduce((sum, row) => sum + Number(row.salary || 0), 0),
      unspent: currentTradeCap(rows, stats, salaryCap ?? rules?.salary_cap),
      by_position_count: rows.reduce((counts, row) => {
        const pos = normalizeHubPosition(row.position);
        counts[pos] = (counts[pos] || 0) + 1;
        return counts;
      }, {}),
    }];
  })), [rosters, rosterByTeam, salaryCap, rules]);
  const deadCapByTeam = useMemo(() => Object.fromEntries(rosters.map(b => [b.team?.id,
    (b.roster || []).filter(r => r.roster_status === "cut_before_draft" && r.dead_cap_amount > 0)])), [rosters]);
  const deadCapBySlot = useMemo(() => Object.fromEntries(Object.values(deadCapByTeam).flat().map(r => [r.id, r])), [deadCapByTeam]);
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
  const [weekState, setWeekState] = useState({ status: "idle" });

  const trade = insights?.trade || {};

  const loadRosters = useCallback(async (signal) => {
    if (!leagueId) return;
    const data = await loadLeagueRosterRequest(cacheScope ? `${cacheScope}:trades` : null, leagueId, async () => {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/rosters?trade_view=1`);
      if (!res.ok) throw new Error(await parseApiError(res));
      return res.json();
    });
    if (signal?.aborted) return;
    setRosters(data.teams || []);
    setLoadedLeague(leagueId);
    if (data.salary_cap != null) setSalaryCap(data.salary_cap);
    return data.teams || [];
  }, [leagueId, cacheScope]);

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

  const weekKey = weeklySnapshotKey(cacheScope || "local", `trades:${leagueId}:${myTeamId}`);
  const loadWeekPreview = useCallback(async (signal) => {
    const cached = cacheScope ? getWeeklySnapshot(weekKey) : null;
    if (cached) { setWeekState({ status: "ready", data: cached }); return; }
    try {
      const res = await apiFetch("/api/hub/week?league_cards=1", { signal });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (signal?.aborted) return;
      if (data.hub_context?.league_id !== leagueId || data.hub_context?.team_id !== myTeamId) {
        setWeekState({ status: "missing" }); return;
      }
      if (cacheScope) setWeeklySnapshot(weekKey, leagueId, data);
      setWeekState({ status: "ready", data });
    } catch {
      if (!signal?.aborted) setWeekState({ status: "missing" });
    }
  }, [weekKey, leagueId, myTeamId, cacheScope]);

  const boot = useCallback(async (signal) => {
    setLoading(true);

    setSecondaryError({});
    setError("");
    try {
      await loadTradeBootstrap({
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
            setBuilderStep("players");
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
        signal,
      });
      if (signal.aborted) return;

    } catch (e) {
      if (!signal.aborted && !isAbortError(e)) setError(connectionErrorMessage(e));
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, [loadRosters, hubContext?.team_id, myTeamId]);

  useEffect(() => {
    const controller = new AbortController();
    boot(controller.signal);
    return () => controller.abort();
  }, [boot]);

  useEffect(() => {
    if (loading || loadedLeague !== leagueId || !["inbox", "ideas"].includes(tab) || secondaryLoaded.current[tab]) return undefined;
    const controller = new AbortController();
    const key = tab;
    setSecondaryStatus(prev => ({ ...prev, [key]: "loading" }));
    setSecondaryError(prev => ({ ...prev, [key]: "" }));
    const load = key === "inbox" ? loadProposals : loadInsights;
    load(controller.signal).then(() => {
      if (controller.signal.aborted) return;
      secondaryLoaded.current[key] = true;
      setSecondaryStatus(prev => ({ ...prev, [key]: "ready" }));
    }).catch(error => {
      if (controller.signal.aborted) return;
      setSecondaryError(prev => ({ ...prev, [key]: connectionErrorMessage(error) }));
      setSecondaryStatus(prev => ({ ...prev, [key]: "error" }));
    });
    return () => controller.abort();
  }, [tab, loading, loadedLeague, leagueId, loadProposals, loadInsights]);

  const activeTab = useRef(tab);
  activeTab.current = tab;
  const seenRevision = useRef(revisionToken);
  useEffect(() => {
    if (revisionToken === seenRevision.current) return undefined;
    seenRevision.current = revisionToken;
    const controller = new AbortController();
    secondaryLoaded.current.ideas = false;
    const inboxOpen = activeTab.current === "inbox";
    if (!inboxOpen) secondaryLoaded.current.inbox = false;
    invalidateWeeklySnapshot(leagueId);
    setWeekState({ status: "idle" });
    Promise.all([loadRosters(controller.signal), ...(inboxOpen ? [loadProposals(controller.signal)] : [])]).catch(() => {});
    return () => controller.abort();
  }, [revisionToken, leagueId, loadProposals, loadRosters]);
  const notifyChanged = () => Promise.resolve(onChanged?.()).catch(() => {});

  // Keep develop's cached season/contract forecasts, but read them only on analytical surfaces.
  const needsOutlook = !loading && loadedLeague === leagueId && (tab === "discover"
    || (tab === "builder" && (dialog === "impact" || phoneView === "impact" || builderStep === "review")));
  useEffect(() => {
    if (!needsOutlook) return undefined;
    const controller = new AbortController();
    let timer;
    const schedule = delay => { timer = setTimeout(() => {
      if (document.visibilityState === "hidden") schedule(60000);
      else load();
    }, delay); };
    const load = async () => {
      let delay = 60000;
      try {
        const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trade-outlook`, { signal: controller.signal });
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        if (controller.signal.aborted) return;
        outlookSnapshot.current = { data, leagueId, revisionToken, at: Date.now() };
        setOutlook(data);
        if (["queued", "running", "busy"].includes(data.recovery?.status)) delay = 5000;
      } catch {
        if (controller.signal.aborted) return;
        const data = { ...outlookSnapshot.current?.data, error: true };
        outlookSnapshot.current = { data, leagueId, revisionToken, at: Date.now() };
        setOutlook(data);
      }
      if (!controller.signal.aborted) schedule(delay);
    };
    const cached = outlookSnapshot.current;
    const interval = ["queued", "running", "busy"].includes(cached?.data?.recovery?.status) ? 5000 : 60000;
    if (cached?.leagueId === leagueId && cached.revisionToken === revisionToken && !cached.data.error && Date.now() - cached.at < interval) {
      setOutlook(cached.data);
      schedule(interval - (Date.now() - cached.at));
    } else load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [needsOutlook, leagueId, revisionToken]);

  const positionRanks = useMemo(() => tab === "discover" ? positionStrengthRanks(rosterByTeam, rules, outlook?.players) : {}, [tab, rosterByTeam, rules, outlook]);
  const rankPositions = useMemo(() => HUB_POS_ORDER.filter(pos => Number(rules?.roster?.[pos.toLowerCase()]?.starter) > 0
    || Object.values(rosterByTeam).some(rows => rows.some(row => normalizeHubPosition(row.position) === pos))), [rules, rosterByTeam]);
  const pointImpact = useMemo(() => needsOutlook ? projectedTradeImpact({ rosterByTeam, parties, myTeamId, rules, forecasts: outlook?.players, salaryLeague }) : null,
    [needsOutlook, rosterByTeam, parties, myTeamId, rules, outlook, salaryLeague]);

  const weekEligible = Boolean(hubContext?.draft_completed) && acquisitionWindow?.trade_scope !== "surviving_contracts";
  const needsWeekPreview = Boolean(myTeamId) && weekEligible && !loading && loadedLeague === leagueId
    && (tab === "inbox" || (tab === "builder" && parties.slice(1).some(p => p.team_id)));
  useEffect(() => {
    if (!needsWeekPreview || weekState.status !== "idle") return undefined;
    const controller = new AbortController();
    loadWeekPreview(controller.signal);
    return () => controller.abort();
  }, [needsWeekPreview, weekState.status, loadWeekPreview]);

  const allPlayerIds = useMemo(() => {
    const ids = new Set();
    parties.forEach((p) => {
      visibleRosterRows(rosterByTeam[p.team_id] || [], p.team_id).forEach((r) => r.player_id && ids.add(r.player_id));
      p.sends.forEach((s) => s.player_id && ids.add(s.player_id));
      p.drops.forEach((d) => ids.add(d));
    });
    (tab === "inbox" ? proposals : []).forEach((prop) => {
      (prop.parties || []).forEach((party) => {
        (party.sends || []).forEach((s) => s.player_id && ids.add(s.player_id));
        (party.drops || []).forEach((d) => ids.add(d));
      });
    });
    (tab === "ideas" ? trade.suggestions || [] : []).forEach((s) => {
      (s.send || []).forEach((x) => x.player_id && ids.add(x.player_id));
      (s.receive || []).forEach((x) => x.player_id && ids.add(x.player_id));
    });
    return [...ids];
  }, [parties, rosterByTeam, proposals, trade.suggestions, tab, search, posFilter, expandedTeams]);
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
    parties.forEach(p => (p.dead_cap_transfers || []).forEach(s => legs.push({
      from: p.team_id, to: s.to_team_id, deadCap: true, amount: s.amount,
      player_id: `dead-${s.roster_slot_id}`, name: deadCapBySlot[s.roster_slot_id]?.player_name || s.player_id,
    })));
    return legs;
  }, [parties, rowByPlayer, deadCapBySlot]);

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

  const weekPayload = weekState.status === "ready" ? weekState.data : null;
  const weekCards = useMemo(() => indexWeekCards(weekPayload?.cards), [weekPayload]);
  const weekStripReady = weekState.status === "ready" || weekState.status === "missing";
  const weekEmptyCopy = useMemo(() => tradeWeekEmptyCopy({
    emptyRoster: Boolean(weekPayload?.status?.empty_roster),
    projectionsMissing: weekState.status === "missing"
      || !weekPayload?.meta?.projections_available
      || Boolean(weekPayload?.status?.projections_missing),
    draftCompleted: Boolean(hubContext?.draft_completed),
  }), [weekPayload, weekState.status, hubContext?.draft_completed]);

  const myWeekPreview = useMemo(() => projectTradeWeekLineup({
    rosterByTeam,
    parties,
    myTeamId,
    weekCards: weekPayload?.cards,
    weekStarters: weekPayload?.roster?.starters,
    rules,
    projectionsAvailable: Boolean(weekPayload?.meta?.projections_available),
    emptyRoster: Boolean(weekPayload?.status?.empty_roster),
  }), [rosterByTeam, parties, myTeamId, weekPayload, rules]);

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
        dead_cap_transfers: p.dead_cap_transfers || [],
      })),
    dead_cap_assignments: deadCapAssignments.filter((a) =>
      parties.some((p) => p.team_id === a.from_team_id && p.drops.includes(a.player_id)),
    ),
  }), [parties, deadCapAssignments]);

  const partnerTeamIds = useMemo(
    () => parties.slice(1).map((p) => p.team_id).filter(Boolean),
    [parties],
  );

  const hasPartner = Boolean(myTeamId) && loadedLeague === leagueId && partnerTeamIds.length > 0;
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
          setValidatedPackage(packageKey);
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
  }, [leagueId, hasPartner, hasPackage, packageKey, revisionToken]);

  const propose = async () => {
    if (validationStatus !== "valid" || validatedPackage !== packageKey || !hasPartner || !hasPackage) return;
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
          source_review_id: sourceReviewId || undefined,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setMsg(formatCopy.proposalSent);
      secondaryLoaded.current.inbox = true;
      setSecondaryStatus(prev => ({ ...prev, inbox: "loading" }));
      setTab("inbox");
      setBuilderStep("players");
      setProposeNote("");
      setSourceReviewId(null);
      setParties([emptyParty(myTeamId), emptyParty("")]);
      setDeadCapAssignments([]);
      await loadProposals().then(() => setSecondaryStatus(prev => ({ ...prev, inbox: "ready" }))).catch(error => {
        secondaryLoaded.current.inbox = false;
        setSecondaryStatus(prev => ({ ...prev, inbox: "error" }));
        setSecondaryError(prev => ({ ...prev, inbox: connectionErrorMessage(error) }));
      });
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
      setMsg(data.proposal?.status === "awaiting_sleeper" ? formatCopy.sleeperAccepted
        : data.proposal?.status === "executed" ? "Trade executed." : approve ? "Accepted." : "Rejected.");
      invalidateInsightsAfterCapSync(leagueId);
      secondaryLoaded.current.ideas = false;
      await loadProposals();
      await loadRosters();
      invalidateWeeklySnapshot(leagueId);
      setWeekState({ status: "idle" });
      notifyChanged();
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
      invalidateInsightsAfterCapSync(leagueId);
      secondaryLoaded.current.ideas = false;
      await loadProposals();
      await loadRosters();
      invalidateWeeklySnapshot(leagueId);
      setWeekState({ status: "idle" });
      notifyChanged();
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

  const resolveSleeper = async (proposalId, action) => {
    setBusy(proposalId);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(proposalId)}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      invalidateInsightsAfterCapSync(leagueId);
      secondaryLoaded.current.ideas = false;
      await loadProposals();
      await loadRosters();
      invalidateWeeklySnapshot(leagueId);
      setWeekState({ status: "idle" });
      notifyChanged();
    } catch (e) { setError(e.message); }
    finally { setBusy(""); }
  };

  const loadCapReview = proposal => {
    const ordered = [...proposal.parties].sort((a, b) => (b.team_id === myTeamId) - (a.team_id === myTeamId));
    setParties(ordered.map(p => emptyParty(p.team_id)));
    setDeadCapAssignments([]);
    setSourceReviewId(proposal.id);
    setTab("builder");
    setBuilderStep("players");
    setProposeNote(proposal.note || "");
  };

  const loadSuggestion = (suggestion) => {
    setSourceReviewId(null);
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
    if (sourceReviewId) return;
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
      const next = retainTradeRecipients([mine, ...(nextPartners.length ? nextPartners : [emptyParty("")])]);
      syncDeadCapDefaults(next);
      setDeadCapAssignments(prev => prev.map(a => ({ ...a,
        assigned_to_team_id: next.some(p => p.team_id === a.assigned_to_team_id)
          ? a.assigned_to_team_id : a.from_team_id,
      })));
      return next;
    });
  };

  const goBuilderStep = (stepId) => {
    setBuilderStep(stepId);
    setPhoneView("send");
  };
  useEffect(() => {
    if (builderStep === "review") reviewRef.current?.focus();
  }, [builderStep]);
  useEffect(() => {
    if (tab === "builder" && !dialog && pendingBuilderFocus.current) {
      pendingBuilderFocus.current = false;
      builderSearchRef.current?.focus({ preventScroll: true });
    }
  }, [dialog, tab]);
  useEffect(() => {
    const bar = deskBarRef.current;
    if (!bar) return undefined;
    const style = document.body.style;
    const previous = style.getPropertyValue("--fantasy-fixed-action-height");
    const hadActions = document.body.classList.contains("has-trade-desk-actions");
    document.body.classList.add("has-trade-desk-actions");
    const update = () => style.setProperty("--fantasy-fixed-action-height", `${Math.ceil(bar.getBoundingClientRect().height) + 16}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => { observer.disconnect();
      if (!hadActions) document.body.classList.remove("has-trade-desk-actions");
      if (previous) style.setProperty("--fantasy-fixed-action-height", previous);
      else style.removeProperty("--fantasy-fixed-action-height");
    };
  }, [tab, loading, loadedLeague, myTeamId, builderStep]);

  function filterRows(rows) {
    const q = search.trim().toLowerCase();
    return rows.filter(r => (posFilter === "ALL" || normalizeHubPosition(r.position) === posFilter)
      && (!q || `${r.player_name || ""} ${r.team || ""} ${r.position || ""}`.toLowerCase().includes(q)));
  }
  function visibleRosterRows(rows, teamId) {
    const filtered = filterRows(rows);
    return expandedTeams[teamId] || search || posFilter !== "ALL" ? filtered : filtered.slice(0, 7);
  }
  const capLimit = salaryCap ?? rules?.salary_cap;
  const otherTeams = teams.filter(t => t.id && t.id !== myTeamId);
  const canPropose = validationStatus === "valid" && validatedPackage === packageKey && hasPartner && hasPackage && !busy;

  const renderPartyPlayerColumns = () => (
    <div className={`hub-trade-parties hub-trade-parties-${Math.min(Math.max(activeParties.length, 2), 4)}`}>
      {activeParties.map((party) => {
        const idx = party.idx;
        const others = parties.filter((p, i) => i !== idx && p.team_id).map((p) => p.team_id);
        const defaultTo = activeParties.length > 2 ? "" : others[0] || "";
        const rows = visibleRosterRows(rosterByTeam[party.team_id] || [], party.team_id);
        const totalRows = (rosterByTeam[party.team_id] || []).length;
        const teamProjected = party.team_id ? projectedByTeam[party.team_id] : null;
        const isYours = party.team_id === myTeamId;
        return (
          <div key={idx} className="hub-trade-party-col panel" data-party={isYours ? "send" : "receive"}>
            <div className="hub-trade-party-direction"><h2>{isYours ? formatCopy.youSend : activeParties.length > 2 ? formatCopy.sendVerb : formatCopy.youReceive}</h2><span>{formatCopy.selectedCount(party.sends.length + party.drops.length)}</span></div>
            <div className="hub-trade-party-head">
              <strong className="hub-trade-party-name">
                {teamName(party.team_id)}
                {isYours ? " (you)" : ""}
              </strong>
              {!isYours && idx === 1 && !sourceReviewId && <button type="button" className="btn-ghost btn-sm" onClick={() => { setMultiPartner(false); setDialog("partner"); }}>{formatCopy.changePartner}</button>}
            </div>

            <div className="hub-trade-roster-context"><span>{salaryLeague ? `${fmtSal(teamProjected?.committed)} ${formatCopy.currentRoster}` : formatCopy.rosterCount(totalRows)}</span>
              <span>{HUB_POS_ORDER.filter(pos => teamProjected?.by_position_count?.[pos]).map(pos => `${pos} ${teamProjected.by_position_count[pos]}`).join(" · ")}</span></div>

            <div className="hub-trade-column-key"><span>{formatCopy.currentRoster}</span><span>{formatCopy.weekPoints}{salaryLeague ? ` / ${formatCopy.salary}` : ""}</span></div>
            <ul className="hub-trade-player-list">
              {rows.length === 0 && (
                <li className="chart-note hub-trade-empty-list">{search || posFilter !== "ALL" ? formatCopy.noMatches : formatCopy.emptyRoster}</li>
              )}
              {rows.map((r) => {
                const sending = party.sends.some((s) => s.player_id === r.player_id);
                const recipientId = party.sends.find(s => s.player_id === r.player_id)?.to_team_id || defaultTo;
                const dropping = party.drops.includes(r.player_id);
                return (
                  <TradePlayerRow
                    key={r.player_id}
                    row={r}
                    advanced={advanced || Boolean(sourceReviewId)}
                    weekP50={weekEligible ? tradeWeekPlayerPoints(r.player_id, weekCards) : null}
                    media={media}
                    sending={sending}
                    dropping={dropping}
                    canSend={Boolean(recipientId) && !sourceReviewId}
                    canDrop={!sleeperLinked && !sourceReviewId}
                    isYours={isYours}
                    destName={recipientId ? teamName(recipientId) : ""}
                    srcName={teamName(party.team_id)}
                    multiTeam={activeParties.length > 2 && !sourceReviewId}
                    recipientId={recipientId}
                    recipientOptions={others.map(id => ({ id, label: teamName(id) }))}
                    onRecipientChange={to => {
                      setParties(prev => {
                        const next = prev.map((p, i) => i !== idx ? p : {
                          ...p,
                          sends: [...p.sends.filter(s => s.player_id !== r.player_id),
                            ...(to ? [{ player_id: r.player_id, to_team_id: to }] : [])],
                          drops: to ? p.drops.filter(pid => pid !== r.player_id) : p.drops,
                        });
                        syncDeadCapDefaults(next);
                        return next;
                      });
                    }}
                    salaryLeague={salaryLeague}
                    copy={formatCopy}
                    tradeLocked={!playerTradeableInWindow(r, acquisitionWindow)}
                    onSend={() => toggleSend(idx, r.player_id, recipientId)}
                    onDrop={() => toggleDrop(idx, r.player_id)}
                  />
                );
              })}
            </ul>

            {salaryLeague && (advanced || sourceReviewId || party.dead_cap_transfers?.length > 0) && (deadCapByTeam[party.team_id] || []).length > 0 && <div className="hub-trade-legs">
              <strong>{formatCopy.deadCapTitle}</strong>
              <p className="chart-note">{formatCopy.deadCapSupport}</p>
              {(deadCapByTeam[party.team_id] || []).map(row => {
                const leg = (party.dead_cap_transfers || []).find(s => s.roster_slot_id === row.id);
                const update = (to, amount) => setParties(prev => prev.map((p, i) => i !== idx ? p : {
                  ...p, dead_cap_transfers: [...(p.dead_cap_transfers || []).filter(s => s.roster_slot_id !== row.id),
                    ...(to ? [{ roster_slot_id: row.id, player_id: row.player_id, to_team_id: to, amount }] : [])],
                }));
                return <div key={row.id} className="hub-trade-leg-row">
                  <span>{row.player_name} · {fmtSal(row.dead_cap_amount)} dead cap</span>
                  {row.dead_cap_sources?.length > 0 && <details>
                    <summary>{formatCopy.deadCapHistory}</summary>
                    {row.dead_cap_sources.map((source, n) => <div key={n}>
                      <p className="chart-note">{formatCopy.deadCapSource(source.player_name || row.player_name,
                        fmtSal(source.amount), teamName(source.origin_team_id), source.season)}</p>
                      {(source.history || []).map((h, j) => <p key={j} className="chart-note">
                        {fmtSal(h.amount)} · {teamName(h.from_team_id)} → {teamName(h.to_team_id)}
                      </p>)}
                    </div>)}
                  </details>}
                  <HubFilterMenu label="To" ariaLabel={formatCopy.recipientFor(row.player_name)} value={leg?.to_team_id || ""}
                    options={[{ id: "", label: formatCopy.chooseRecipient }, ...others.map(id => ({ id, label: teamName(id) }))]}
                    onChange={to => update(to, leg?.amount ?? row.dead_cap_amount)} />
                  {leg && <label>{formatCopy.deadCapAmount}
                    <input type="number" min="1" step="1" max={row.dead_cap_amount}
                      aria-label={`${formatCopy.deadCapAmount} from ${row.player_name}`}
                      value={leg.amount} onChange={e => update(leg.to_team_id, Number(e.target.value))} />
                  </label>}
                </div>;
              })}
            </div>}

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
            <footer className="hub-trade-roster-footer"><span>{formatCopy.rosterCount(totalRows)}</span>{totalRows > 7 && !search && posFilter === "ALL" && <button type="button" className="btn-link" onClick={() => setExpandedTeams(prev => ({ ...prev, [party.team_id]: !prev[party.team_id] }))}>{expandedTeams[party.team_id] ? formatCopy.showFewer : formatCopy.viewRoster(totalRows)}</button>}</footer>
          </div>
        );
      })}
      {!hasPartner && myTeamId && <section className="hub-trade-party-col panel hub-trade-partner-empty" data-party="receive"><h2>{formatCopy.youReceive}</h2><p>{otherTeams.length ? formatCopy.rosterEmpty : formatCopy.noPartners}</p>{otherTeams.length > 0 && <button type="button" className="btn-ghost" onClick={() => { setMultiPartner(false); setDialog("partner"); }}>{formatCopy.choosePartner}</button>}</section>}
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
              {salaryLeague && !leg.deadCap && <span className="hub-trade-salary-inline">{fmtSal(leg.salary)}</span>}
              <span className="hub-trade-leg-flow">{leg.deadCap
                ? formatCopy.deadCapFlow(leg.name, fmtSal(leg.amount), teamName(leg.from), teamName(leg.to))
                : packageLegFlow(leg, teamName, formatCopy.cutVerb)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="chart-note">{formatCopy.noPackageYet}</p>
      )}
    </div>
  );

  const renderCapReview = () => (
    <div className="hub-trade-cap-review" aria-label={salaryLeague ? "Cap impact review" : "Roster impact review"}>
      {activeParties.map((party) => (
        <div key={party.team_id} className="hub-trade-cap-review-card panel">
          <div className="hub-trade-cap-review-head">
            <strong>
              {teamName(party.team_id)}
              {party.team_id === myTeamId ? " (you)" : ""}
            </strong>
          </div>
          <TeamCapStrip
            projected={projectedByTeam[party.team_id]}
            salaryCap={capLimit}
            salaryLeague={salaryLeague}
          />
          {weekStripReady && party.team_id === myTeamId && (
            <TradeWeekStrip
              preview={myWeekPreview}
              emptyCopy={weekEmptyCopy}
              media={media}
            />
          )}
          {(party.sends.length > 0 || party.drops.length > 0 || receivingFor(party.team_id).length > 0
            || packageLegs.some(leg => leg.deadCap && (leg.from === party.team_id || leg.to === party.team_id))) && (
            <div className="hub-trade-cap-review-legs">
              {packageLegs.filter(leg => leg.deadCap && (leg.from === party.team_id || leg.to === party.team_id)).map(leg =>
                <p key={`${leg.from}-${leg.player_id}`} className="table-meta">
                  {formatCopy.deadCapFlow(leg.name, fmtSal(leg.amount), teamName(leg.from), teamName(leg.to))}
                </p>)}
              {receivingFor(party.team_id).map((s) => (
                <div key={`in-${s.player_id}`} className="hub-trade-leg-row">
                  <span className="table-meta">{formatCopy.getVerb}</span>
                  <span className="hub-roster-pos-tag">{s.row?.position || "?"}</span>
                  <span>{s.row?.player_name || s.player_id}</span>
                    {salaryLeague && <span className="hub-trade-salary-inline">{fmtSal(s.row?.salary)}</span>}
                </div>
              ))}
              {party.sends.map((s) => {
                const row = rowByPlayer[s.player_id];
                return (
                  <div key={`out-${s.player_id}`} className="hub-trade-leg-row">
                    <span className="table-meta">{formatCopy.sendVerb}</span>
                    <span className="hub-roster-pos-tag">{row?.position || "?"}</span>
                    <span>{playerLabel(party.team_id, s.player_id)}</span>
                    <span className="table-meta">→ {teamName(s.to_team_id)}</span>
                    {salaryLeague && <span className="hub-trade-salary-inline">{fmtSal(row?.salary)}</span>}
                  </div>
                );
              })}
              {party.drops.map((pid) => {
                const row = rowByPlayer[pid];
                const a = deadCapAssignments.find(
                  (x) => x.player_id === pid && x.from_team_id === party.team_id,
                );
                return (
                  <div key={`drop-${pid}`} className="hub-trade-leg-row">
                    <span className="table-meta">{formatCopy.cutVerb}</span>
                    <span className="hub-roster-pos-tag">{row?.position || "?"}</span>
                    <span>{playerLabel(party.team_id, pid)}</span>
                    {salaryLeague && a?.assigned_to_team_id && (
                      <span className="table-meta">dead → {teamName(a.assigned_to_team_id)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const renderFullImpact = () => <div className="hub-trade-full-impact">
    {tradeForecastStatus(outlook) && <p role="status" className="chart-note">{tradeForecastStatus(outlook)}</p>}
    {pointImpact && <TradeImpactGrid impact={pointImpact} salaryLeague={salaryLeague} hasPackage={hasPackage} />}
    <details className="hub-trade-projection-method"><summary>{TRADE_DISCOVERY_COPY.projectionDetails}</summary>
      <p className="chart-note">{salaryLeague ? TRADE_DISCOVERY_COPY.method : TRADE_DISCOVERY_COPY.rosterMethod}</p></details>
    {renderCapReview()}
  </div>;

  const renderPartnerCards = () => (
    <>
      {hasPackage && !multiPartner && <p className="chart-note">{formatCopy.newPartnerPackage}</p>}
      <input type="search" className="search-input" value={partnerSearch} onChange={e => setPartnerSearch(e.target.value)}
        placeholder={formatCopy.partnerSearch} aria-label={formatCopy.partnerSearch} />
      <ul className="hub-trade-partner-grid">
        {otherTeams.filter(t => teamName(t.id).toLowerCase().includes(partnerSearch.toLowerCase())).map(t => {
          const selected = partnerTeamIds.includes(t.id);
          const insight = (trade.partners || []).find(p => p.team_id === t.id);
          return <li key={t.id}><button type="button" className={`hub-trade-partner-card${selected ? " is-selected" : ""}`}
            disabled={!myTeamId || Boolean(sourceReviewId)} aria-pressed={selected}
            onClick={() => {
              if (multiPartner) togglePartner(t.id);
              else {
                if (!selected || partnerTeamIds.length > 1) {
                  setParties([emptyParty(myTeamId), emptyParty(t.id)]);
                  setDeadCapAssignments([]);
                  setProposeNote("");
                  setError("");
                  setMsg("");
                }
                pendingBuilderFocus.current = true;
                setTab("builder"); setBuilderStep("players"); setPhoneView("send"); setDialog(null);
              }
            }}>
            <strong>{teamName(t.id)}</strong>
            <span className="hub-trade-partner-meta">{partnerCardMeta({ stats: statsByTeam[t.id], insight,
              byPos: statsByTeam[t.id]?.by_position_count, includeCap: salaryLeague })}</span>
            <span className="table-meta">{selected ? formatCopy.selectedPartner : formatCopy.selectPartner}</span>
          </button></li>;
        })}
      </ul>
      {!otherTeams.length && <p>{formatCopy.noPartners}</p>}
    </>
  );

  const renderImpactBand = () => {
    const mine = projectedByTeam[myTeamId];
    const partner = projectedByTeam[partnerTeamIds[0]];
    const weekAvailable = hasPackage && weekEligible && myWeekPreview.available;
    return <section className="hub-trade-impact-band" aria-label={formatCopy.fullImpact}>
      <div><span>{formatCopy.yourStarters}{weekPayload?.meta?.week ? ` · ${formatCopy.weekLabel(weekPayload.meta.week)}` : ""}</span><strong className={weekAvailable ? `is-${tradeWeekTone(myWeekPreview.delta)}` : ""}>
        {weekAvailable ? `${myWeekPreview.delta > 0 ? "+" : ""}${myWeekPreview.delta.toFixed(1)}` : "—"}
      </strong><small>{weekAvailable ? `${myWeekPreview.before_p50.toFixed(1)} → ${myWeekPreview.after_p50.toFixed(1)} · ${formatCopy.pprEstimate}`
        : !weekEligible ? formatCopy.weekClosed : !hasPartner ? formatCopy.weekSelect
          : !hasPackage ? formatCopy.emptyAction
            : weekState.status === "idle" ? formatCopy.weekLoading : weekEmptyCopy}</small></div>
      <div><span>{salaryLeague ? formatCopy.yourCap : formatCopy.yourRoster}</span><strong>
        {salaryLeague ? fmtSal(mine?.unspent) : mine ? Object.values(mine.by_position_count).reduce((sum,n) => sum+n,0) : "—"}
      </strong><small>{salaryLeague ? formatCopy.beforeValue(fmtSal(mine?.base?.unspent)) : formatCopy.rosterBalance}</small></div>
      <div className="hub-trade-impact-partner"><span>{salaryLeague ? formatCopy.partnerCap : formatCopy.partnerRoster}</span><strong>
        {salaryLeague ? fmtSal(partner?.unspent) : partner ? Object.values(partner.by_position_count).reduce((sum,n) => sum+n,0) : "—"}
      </strong><small>{hasPartner ? teamName(partnerTeamIds[0]) : formatCopy.partnerNeeded}</small></div>
      <button type="button" className="btn-link" onClick={() => setDialog("impact")} disabled={!myTeamId}>{formatCopy.fullImpact} ↗</button>
    </section>;
  };

  const renderDeskBar = () => {
    const outgoing = packageLegs.filter(leg => leg.from === myTeamId);
    const incoming = packageLegs.filter(leg => leg.to === myTeamId);
    return <div className="hub-trade-desk-bar" ref={deskBarRef}>
      <div className="hub-trade-package-mini" aria-label={formatCopy.packageTitle}>
        {[{ label: formatCopy.youSend, legs: outgoing }, { label: formatCopy.youReceive, legs: incoming }].map(side =>
          <div key={side.label}><span>{side.label}</span><strong title={side.legs.map(leg => leg.name).join(", ")}>
            {side.legs.map(leg => `${leg.drop ? formatCopy.cutVerb + " " : leg.deadCap ? formatCopy.dead + " · " : ""}${leg.name}`).join(", ") || "—"}
          </strong></div>)}
      </div>
      {hasPackage ? <TradeVerdict status={validationStatus} errors={validationErrors} message={validationMessage} />
        : <span className="hub-trade-bar-hint">{!otherTeams.length ? formatCopy.noPartners : !hasPartner ? formatCopy.partnerNeeded : formatCopy.emptyAction}</span>}
      {!otherTeams.length ? <button type="button" className="btn-ghost" disabled={!myTeamId} onClick={() => onNavigate?.("office-members")}>{formatCopy.inviteManagers}</button>
        : !hasPartner ? <button type="button" className="btn-ghost" disabled={!myTeamId} onClick={() => { setMultiPartner(false); setDialog("partner"); }}>{formatCopy.choosePartner}</button>
          : builderStep === "review" ? <button type="button" className="btn-primary" disabled={!canPropose} onClick={propose}>
            {busy === "propose" ? formatCopy.proposing : formatCopy.proposeTrade}</button>
            : <button type="button" className="btn-primary" disabled={!canPropose} onClick={() => goBuilderStep("review")}>{formatCopy.reviewTrade} →</button>}
    </div>;
  };

  return (
    <HubPage className="hub-experience-page hub-trade-desk">
      <HubExperienceHero
        eyebrow={formatCopy.eyebrow}
        heading={formatCopy.heading}
        support={formatCopy.support}
        compact
      />
      {tradeBanner ? (
        <HubAlert variant={tradeBanner.variant}>
          <strong>{tradeBanner.label}.</strong>
          {" "}
          {tradeBanner.text}
        </HubAlert>
      ) : null}

      <HubSegmentNav
        ariaLabel="Trades"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "builder", label: formatCopy.buildTab },
          { id: "discover", label: formatCopy.discoverTab },
          { id: "ideas", label: formatCopy.ideasTab },
          { id: "inbox", label: `${formatCopy.inboxTab}${secondaryLoaded.current.inbox && proposals.length ? ` (${proposals.length})` : ""}` },
        ]}
      />

      {error && (
        <div className="error hub-trade-alerts" role="alert">
          {error}
        </div>
      )}
      {sleeperLinked && <HubAlert variant="info">{formatCopy.sleeperSupport}</HubAlert>}
      {msg && tab !== "builder" && (
        <HubAlert variant="ready">{msg}</HubAlert>
      )}
      {loading && <HubLoadingSkeleton label="Loading trades" rows={4} />}
      {tab !== "builder" && secondaryLoading && <HubLoadingSkeleton label={formatCopy.loadingDetails} rows={4} />}
      {tab !== "builder" && secondaryError[tab] && <HubAlert variant="warn">{secondaryError[tab]}</HubAlert>}

      {tab === "discover" && !loading && loadedLeague === leagueId && <section className="hub-trade-discover">
        <h2>{formatCopy.pickPartnerTitle}</h2><p className="chart-note">{formatCopy.pickPartnerSupport}</p>
        <TradeDiscovery outlook={outlook} teams={teams} myTeamId={myTeamId} rosterByTeam={rosterByTeam} statsByTeam={statsByTeam}
          salaryCap={capLimit} salaryLeague={salaryLeague} ranks={positionRanks} positions={rankPositions}
          search={partnerSearch} onSearch={setPartnerSearch} onChoose={id => {
            if (!myTeamId) return;
            setSourceReviewId(null); setParties([emptyParty(myTeamId), emptyParty(id)]); setDeadCapAssignments([]);
            setProposeNote(""); setSearch(""); pendingBuilderFocus.current = true;
            setTab("builder"); setBuilderStep("players"); setPhoneView("send");
          }} />
      </section>}
      {tab === "builder" && !loading && loadedLeague === leagueId && <div className="hub-trade-builder" id="trades-panel-builder">
        {!myTeamId ? <HubAlert variant="info">{formatCopy.teamNeeded}</HubAlert> : <>
          {builderStep !== "review" ? <div className="hub-trade-workspace" data-phone-view={phoneView}>
            {renderImpactBand()}
            <nav className="hub-trade-phone-views" aria-label={formatCopy.buildTab}>
              {[["send",formatCopy.youSend], ["receive",formatCopy.youReceive], ["impact",formatCopy.impact]].map(([id,label]) =>
                <button key={id} type="button" aria-pressed={phoneView === id} onClick={() => setPhoneView(id)}>{label}</button>)}
            </nav>
            <div className="hub-trade-roster-workspace">
              <div className="hub-trade-filters">
                <input ref={builderSearchRef} type="search" className="search-input hub-filter-search" placeholder={formatCopy.playerSearch}
                  aria-label={formatCopy.filterBoth} value={search} onChange={e => setSearch(e.target.value)} />
                <HubFilterMenu label={formatCopy.position} value={posFilter} onChange={setPosFilter}
                  options={HUB_POSITION_FILTERS.map(id => ({ id, label: id === "ALL" ? formatCopy.allPositions : id }))} />
              </div>
              {renderPartyPlayerColumns()}
              <div className="hub-trade-advanced-actions">
                <button type="button" className="btn-link" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>{formatCopy.advancedTerms} {advanced ? "−" : "+"}</button>
                {advanced && !sourceReviewId && <button type="button" className="btn-ghost" onClick={() => { setMultiPartner(true); setDialog("partner"); }}>{formatCopy.addPartners}</button>}
              </div>
            </div>
            <div className="hub-trade-phone-impact">{phoneView === "impact" && renderFullImpact()}</div>
          </div> : <section className="hub-trade-review" ref={reviewRef} tabIndex={-1} aria-label={formatCopy.reviewHeading}>
            <header><h2>{formatCopy.reviewHeading}</h2><button type="button" className="btn-link" onClick={() => goBuilderStep("players")}>← {formatCopy.editPackage}</button></header>
            {renderPackageSummary()}{renderFullImpact()}
            <label className="hub-trade-note-label" htmlFor="trade-propose-note">{formatCopy.proposeNoteLabel}</label>
            <textarea id="trade-propose-note" className="hub-trade-note" rows={3} value={proposeNote}
              onChange={e => setProposeNote(e.target.value)} placeholder={formatCopy.proposeNotePlaceholder} />
            <section className="hub-trade-next"><h3>{formatCopy.afterProposal}</h3><p>{sourceReviewId ? formatCopy.capAgreementNotifyLine : sleeperLinked ? formatCopy.sleeperNotifyLine : formatCopy.nativeNext}</p>
              {sleeperLinked && <p>{formatCopy.sleeperSupport}</p>}<p>{formatCopy.whatsNext} {formatCopy.privateWeek}</p></section>
          </section>}
          {renderDeskBar()}
        </>}
      </div>}
      {dialog && <TradeDeskDialog title={dialog === "partner" ? formatCopy.pickPartnerTitle : formatCopy.fullImpact} onClose={() => setDialog(null)}>
        {dialog === "partner" ? <>{renderPartnerCards()}<button type="button" className="btn-ghost" onClick={() => setDialog(null)}>{formatCopy.doneChoosing}</button></> : renderFullImpact()}
      </TradeDeskDialog>}

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
                  {p.status === "awaiting_sleeper" ? formatCopy.waitingSleeper
                    : p.status === "cap_review" ? formatCopy.syncedMoves : p.status}
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
                              name={row?.player_name || s.player_name || s.player_id}
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
                  {(party.dead_cap_transfers || []).map(leg => <p key={leg.roster_slot_id} className="table-meta">
                    {formatCopy.deadCapFlow(deadCapBySlot[leg.roster_slot_id]?.player_name || leg.player_id,
                      fmtSal(leg.amount), teamName(party.team_id), teamName(leg.to_team_id))}
                  </p>)}
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
                {p.status === "awaiting_sleeper" && (isCommissioner || p.parties.some(x => x.team_id === myTeamId)) &&
                  <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)}
                    onClick={() => resolveSleeper(p.id, "settle")}>{formatCopy.settleCap}</button>}
                {p.status === "cap_review" && (isCommissioner || p.parties.some(x => x.team_id === myTeamId)) && <>
                  <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)}
                    onClick={() => loadCapReview(p)}>{formatCopy.reviewCapTerms}</button>
                  {isCommissioner && <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)}
                    onClick={() => resolveSleeper(p.id, "reviewed")}>{formatCopy.closeCapReview}</button>}
                </>}
                {p.status === "pending" && p.acceptances?.[myTeamId] === "pending" && (
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
                {p.status !== "cap_review" && (isCommissioner || (p.parties || []).some((x) => x.team_id === myTeamId)) && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={Boolean(busy)}
                    onClick={() => cancelProp(p.id)}
                  >
                    Cancel
                  </button>
                )}
                {isCommissioner && p.status === "pending" && !sleeperLinked && (
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
