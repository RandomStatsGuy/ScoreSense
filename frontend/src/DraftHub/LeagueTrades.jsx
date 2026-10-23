import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useModalFocus from "../ui/useModalFocus";
import "../styles/trade-desk.css";
import "../styles/league-trades.css";
import TradeDiscovery from "./TradeDiscovery";
import TradeImpactGrid from "./TradeImpactGrid";
import { positionStrengthRanks, projectedTradeImpact, currentTradeCap } from "./tradeOutlook";
import { TRADE_DISCOVERY_COPY, tradeForecastStatus, tradePackageHeadline, tradeVersionComparison, tradeCapChangeText,
  tradeExchangeLedger, tradeAcceptanceLabel, tradeProposalStatus } from "./leagueTradesPresentation";
import TeamIdentityMark from "./TeamIdentityMark";
import IdentityCropMedia from "./IdentityCropMedia";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import { HUB_MEDIA_HERO_WIDTH, identityMediaUrl, mergeTeamIdentity } from "./atmosphereCatalog";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import { PlayerCardReadScope } from "../PlayerCardContext";
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
import { hubTeamLabel, hubTeamParts } from "./hubTeamLabel";
import { clearTradeSeed, readTradeSeed, resolveTradePartnerId } from "./tradeSeed";
import { formatStatDelta, projectTeamTradeStats } from "./tradeProjection";
import { formatIdeaCapNet, ideaCapImpact, whyThisHelpsText } from "./tradeIdeaHelpers";
import { playerTradeableInWindow, tradesWindowBanner } from "./acquisitionWindow";
import { expireChipLabel, TRADES_COPY, tradesCopyForFormat, tradesFreeLabel } from "./leagueTradesPresentation";
import { leagueUsesSalaries } from "./leagueCapabilities";
import {
  cloneTradeDraft,
  removeTradePackageLeg,
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

/** Saved team banner (or preset fill) faded behind a Face-off column or duel half. */
function TradeTeamArt({ identity }) {
  const look = mergeTeamIdentity(identity);
  const src = identityMediaUrl(look, "banner", { width: HUB_MEDIA_HERO_WIDTH });
  return <span className={`hub-trade-team-art hub-banner-fill--${look.banner_preset}`} aria-hidden="true">
    {src && <IdentityCropMedia key={src} src={src} focus={look.banner_focus} width={HUB_MEDIA_HERO_WIDTH} />}
  </span>;
}

/** Team mark, owner name and team nickname. Fantasy single-season identities lead with the team. */
function TradeTeamHead({ team, identity, isYou, copy, children }) {
  const parts = hubTeamParts(team);
  const title = parts.team || parts.owner || hubTeamLabel(team) || "—";
  const sub = parts.team && parts.owner ? parts.owner : "";
  return <div className="hub-trade-team-head">
    <TeamIdentityMark team={team} identity={identity} size="md" />
    <div className="hub-trade-team-head-text">
      <strong>{title}{isYou ? ` ${copy.youSuffix}` : ""}</strong>
      {sub && <small>{sub}</small>}
    </div>
    {children}
  </div>;
}

/** One leg of the exchange: who, contract facts, weekly points and an optional remove. */
function TradeDealRow({ leg, row, media, salaryLeague, weekP50, flow, onRemove, copy, busy }) {
  const name = leg.name || row?.player_name || leg.player_id;
  const position = leg.position || row?.position;
  const yrs = row?.contract_years ?? row?.contract?.years_remaining;
  const meta = leg.deadCap
    ? [`${fmtSal(leg.amount)} ${copy.dead}`, flow].filter(Boolean)
    : [leg.drop ? copy.cutVerb : null, salaryLeague ? fmtSal(leg.salary ?? row?.salary) : null,
      salaryLeague && yrs != null ? `${yrs}y` : null, salaryLeague ? contractTypeLabel(row?.contract_type || row?.contract?.contract_type) : null,
      flow].filter(Boolean);
  return <div className={`hub-trade-deal-row${leg.drop ? " is-cut" : ""}${leg.deadCap ? " is-dead-cap" : ""}`}>
    <div className="hub-trade-deal-who">
      {leg.deadCap
        ? <strong className="hub-trade-deal-name">{name}</strong>
        : <PlayerCell name={name} team={row?.team} playerId={leg.player_id} position={position} media={media} size="sm" showTeam={false} clickable narrativeScope="season" />}
      {meta.length > 0 && <small className="hub-trade-deal-meta">{meta.join(" · ")}</small>}
    </div>
    {!leg.deadCap && <span className="hub-trade-deal-pts"><strong>{weekP50 == null ? "—" : weekP50.toFixed(1)}</strong><small>{copy.weekPtsShort}</small></span>}
    {onRemove && <button type="button" className="btn-ghost hub-trade-deal-remove" disabled={busy} onClick={onRemove}
      aria-label={copy.removeMove(name)}><span aria-hidden="true">×</span></button>}
  </div>;
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

function TradeVerdict({ status, errors, message, compact = false, copy = TRADES_COPY }) {
  const banner = validationBanner(status, errors, message);
  if (!banner) {
    return <div className={compact ? "hub-trade-verdict-compact" : "hub-trade-verdict-slot"} aria-hidden="true" />;
  }
  return (
    <div className={compact ? "hub-trade-verdict-compact" : "hub-trade-verdict-slot"}>
      <HubAlert variant={banner.variant} role={banner.role} live={banner.live}>
        {compact && status === "valid" ? copy.limitsPass : compact && status === "pending" ? copy.checkingShort : banner.text}
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
  const [activeVersion, setActiveVersion] = useState("A");
  const [otherDraft, setOtherDraft] = useState(null);
  const [lastRemoved, setLastRemoved] = useState(null);
  const undoRef = useRef(null);
  const removalFocus = useRef(false);
  const [dialog, setDialog] = useState(null);
  const [multiPartner, setMultiPartner] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState({});
  const reviewRef = useRef(null);
  const builderSearchRef = useRef(null);
  const partnerHeadingRef = useRef(null);
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
  const [validationRetryable, setValidationRetryable] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [proposalError, setProposalError] = useState("");
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
  const { identities } = useTeamIdentities();
  const teamById = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams]);
  const identityForTeam = (teamId) => identityFor(identities, teamById[teamId]);
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
    || (tab === "builder" && (dialog === "impact" || builderStep === "review")));
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

  const buildLegs = useCallback((partyList) => {
    const legs = [];
    partyList.forEach((p) => {
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
    partyList.forEach(p => (p.dead_cap_transfers || []).forEach(s => legs.push({
      from: p.team_id, to: s.to_team_id, deadCap: true, amount: s.amount,
      roster_slot_id: s.roster_slot_id, player_id: `dead-${s.roster_slot_id}`, name: deadCapBySlot[s.roster_slot_id]?.player_name || s.player_id,
    })));
    return legs;
  }, [rowByPlayer, deadCapBySlot]);
  const packageLegs = useMemo(() => buildLegs(parties), [buildLegs, parties]);

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

  const otherWeekPreview = useMemo(() => otherDraft ? projectTradeWeekLineup({
    rosterByTeam, parties: otherDraft.parties, myTeamId, weekCards: weekPayload?.cards,
    weekStarters: weekPayload?.roster?.starters, rules,
    projectionsAvailable: Boolean(weekPayload?.meta?.projections_available),
    emptyRoster: Boolean(weekPayload?.status?.empty_roster),
  }) : null, [otherDraft, rosterByTeam, myTeamId, weekPayload, rules]);
  const otherProjected = useMemo(() => otherDraft ? projectTeamTradeStats({
    teamId: myTeamId, statsByTeam, rosterByTeam, rowByPlayer, parties: otherDraft.parties,
    deadCapAssignments: otherDraft.deadCapAssignments, rules, salaryCap: salaryCap ?? rules?.salary_cap,
  }) : null, [otherDraft, myTeamId, statsByTeam, rosterByTeam, rowByPlayer, rules, salaryCap]);
  const comparisonRows = tradeVersionComparison({ current: projectedByTeam[myTeamId], other: otherProjected,
    currentWeek: weekEligible ? myWeekPreview : null, otherWeek: weekEligible ? otherWeekPreview : null, salaryLeague });
  const packageHeadline = tradePackageHeadline({ parties, myTeamId, projected: projectedByTeam[myTeamId],
    weekPreview: weekEligible ? myWeekPreview : null, rules, salaryLeague });

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
  const captureDraft = () => cloneTradeDraft({ parties, deadCapAssignments, proposeNote, sourceReviewId });
  const resetComparison = () => { setOtherDraft(null); setActiveVersion("A"); setLastRemoved(null); };
  const applyDraft = draft => {
    const next = cloneTradeDraft(draft);
    setParties(next.parties); setDeadCapAssignments(next.deadCapAssignments);
    setProposeNote(next.proposeNote || ""); setSourceReviewId(next.sourceReviewId || null);
    setError(""); setMsg(""); setLastRemoved(null);
  };
  const switchVersion = id => {
    if (id === activeVersion || !otherDraft || busy) return;
    const current = captureDraft();
    applyDraft(otherDraft); setOtherDraft(current); setActiveVersion(id);
  };
  const removePackageLeg = leg => {
    if (busy) return;
    const before = captureDraft();
    const next = removeTradePackageLeg(before, leg);
    setParties(next.parties); setDeadCapAssignments(next.deadCapAssignments);
    setLastRemoved({ draft: before, key: packageFingerprint(next.parties, next.deadCapAssignments) });
    removalFocus.current = true;
  };
  const undoPackageRemoval = () => {
    if (!lastRemoved || busy) return;
    const next = cloneTradeDraft(lastRemoved.draft);
    setParties(next.parties); setDeadCapAssignments(next.deadCapAssignments); setLastRemoved(null);
  };
  useEffect(() => {
    if (lastRemoved && lastRemoved.key !== packageKey) setLastRemoved(null);
  }, [packageKey, lastRemoved]);
  useEffect(() => {
    if (removalFocus.current && lastRemoved) {
      removalFocus.current = false;
      undoRef.current?.focus({ preventScroll: true });
    }
  }, [lastRemoved]);
  useEffect(() => { resetComparison(); }, [leagueId, myTeamId, cacheScope]);
  payloadRef.current = buildPayload;

  useEffect(() => {
    setProposalError("");
    setValidationRetryable(false);
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
        setValidationRetryable(true);
        setValidationErrors([e.message || formatCopy.invalidFallback]);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [leagueId, hasPartner, hasPackage, packageKey, revisionToken, validationAttempt]);

  const propose = async () => {
    if (validationStatus !== "valid" || validatedPackage !== packageKey || !hasPartner || !hasPackage) return;
    setBusy("propose");
    setProposalError("");
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
      resetComparison();
      setSourceReviewId(null);
      setParties([emptyParty(myTeamId), emptyParty("")]);
      setDeadCapAssignments([]);
      await loadProposals().then(() => setSecondaryStatus(prev => ({ ...prev, inbox: "ready" }))).catch(error => {
        secondaryLoaded.current.inbox = false;
        setSecondaryStatus(prev => ({ ...prev, inbox: "error" }));
        setSecondaryError(prev => ({ ...prev, inbox: connectionErrorMessage(error) }));
      });
    } catch (e) {
      setProposalError(connectionErrorMessage(e));
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
    resetComparison();
    const ordered = [...proposal.parties].sort((a, b) => (b.team_id === myTeamId) - (a.team_id === myTeamId));
    setParties(ordered.map(p => emptyParty(p.team_id)));
    setDeadCapAssignments([]);
    setSourceReviewId(proposal.id);
    setTab("builder");
    setBuilderStep("players");
    setProposeNote(proposal.note || "");
  };

  const loadSuggestion = (suggestion) => {
    resetComparison();
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

  const openPartnerPicker = (multiple = false) => {
    setPartnerSearch("");
    setMultiPartner(multiple);
    setDialog("partner");
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
      partnerHeadingRef.current?.focus({ preventScroll: true });
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
    <div className={`hub-trade-faceoff${activeParties.length > 2 ? " is-multi" : ""}`}>
      {activeParties.map((party, order) => {
        const idx = party.idx;
        const others = parties.filter((p, i) => i !== idx && p.team_id).map((p) => p.team_id);
        const defaultTo = activeParties.length > 2 ? "" : others[0] || "";
        const rows = visibleRosterRows(rosterByTeam[party.team_id] || [], party.team_id);
        const totalRows = (rosterByTeam[party.team_id] || []).length;
        const teamProjected = party.team_id ? projectedByTeam[party.team_id] : null;
        const isYours = party.team_id === myTeamId;
        return (
          <React.Fragment key={idx}>
          {order === 1 && <div className="hub-trade-exchange-col">{renderExchange()}</div>}
          <div className="hub-trade-party-col panel" data-party={isYours ? "send" : "receive"}>
            <TradeTeamArt identity={identityForTeam(party.team_id)} />
            <div className="hub-trade-party-direction"><h2>{isYours ? formatCopy.youSend : activeParties.length > 2 ? formatCopy.sendVerb : formatCopy.youReceive}</h2><span>{formatCopy.selectedCount(party.sends.length + party.drops.length)}</span></div>
            <div className="hub-trade-party-head" ref={idx === 1 ? partnerHeadingRef : undefined}
              tabIndex={idx === 1 ? -1 : undefined}>
              <TradeTeamHead team={teamById[party.team_id]} identity={identityForTeam(party.team_id)} isYou={isYours} copy={formatCopy} />
              {!isYours && idx === 1 && !sourceReviewId && <button type="button" className="btn-ghost btn-sm" onClick={() => openPartnerPicker()}>{formatCopy.changePartner}</button>}
            </div>

            <div className="hub-trade-roster-context"><span>{salaryLeague ? `${fmtSal(teamProjected?.unspent)} ${formatCopy.free}` : formatCopy.rosterCount(totalRows)}</span>
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
          </React.Fragment>
        );
      })}
      {!hasPartner && myTeamId && <>
        <div className="hub-trade-exchange-col">{renderExchange()}</div>
        <section className="hub-trade-party-col panel hub-trade-partner-empty" data-party="receive"><h2>{formatCopy.youReceive}</h2><p>{otherTeams.length ? formatCopy.rosterEmpty : formatCopy.noPartners}</p>{otherTeams.length > 0 && <button type="button" className="btn-ghost" onClick={() => openPartnerPicker()}>{formatCopy.choosePartner}</button>}</section>
      </>}
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
                setSearch(""); setPosFilter("ALL");
                setTab("builder"); setBuilderStep("players"); setPhoneView("receive"); setDialog(null);
              }
            }}>
            <strong>{teamName(t.id)}</strong>
            <span className="hub-trade-partner-meta">{partnerCardMeta({ stats: statsByTeam[t.id], insight,
              byPos: statsByTeam[t.id]?.by_position_count, includeCap: salaryLeague })}</span>
            <span className="table-meta">{selected ? formatCopy.selectedPartner : formatCopy.selectPartner}</span>
          </button></li>;
        })}
      </ul>
      {otherTeams.length > 0 && !otherTeams.some(t => teamName(t.id).toLowerCase().includes(partnerSearch.toLowerCase()))
        && <p role="status">{formatCopy.noPartnerMatches}</p>}
      {!otherTeams.length && <p>{formatCopy.noPartners}</p>}
    </>
  );

  const renderVersionTools = () => otherDraft ? <div className="hub-trade-version-tools">
    <div className="hub-trade-version-switch" role="group" aria-label={formatCopy.compareVersions}>
      {["A", "B"].map(id => <button type="button" key={id} aria-pressed={activeVersion === id}
        disabled={Boolean(busy)} onClick={() => switchVersion(id)} aria-label={formatCopy.version(id)}>{id}</button>)}
    </div>
    <button type="button" className="btn-link hub-trade-version-keep" disabled={Boolean(busy)}
      onClick={resetComparison} aria-label={formatCopy.keepVersion(activeVersion)} title={formatCopy.keepVersion(activeVersion)}>×</button>
  </div> : hasPackage && <button type="button" className="btn-ghost hub-trade-version-start" aria-label={formatCopy.tryVersion} title={formatCopy.tryVersion} disabled={Boolean(busy)} onClick={() => {
    setOtherDraft(captureDraft()); setActiveVersion("B"); setLastRemoved(null);
  }}><span className="hub-trade-version-start-label">{formatCopy.tryVersion}</span><span className="hub-trade-version-start-short">{formatCopy.compareAction}</span><span aria-hidden="true">⇄</span></button>;

  const renderDecision = () => (packageHeadline || otherDraft) && <div className="hub-trade-decision">
    <div className="hub-trade-decision-copy">
      {packageHeadline && <p className={`hub-trade-headline is-${packageHeadline.tone}`} aria-label={formatCopy.packageImpact} title={packageHeadline.text}><span className="hub-trade-headline-full">{packageHeadline.text}</span><span className="hub-trade-headline-compact">{packageHeadline.compactText || packageHeadline.text}</span></p>}
      {otherDraft && <p className="hub-trade-comparison" aria-live="polite">
        <span>{formatCopy.comparedWith(activeVersion === "A" ? "B" : "A")}</span>
        {comparisonRows.map(row => <span key={row.text} className={`is-${row.tone}`}>{row.text}</span>)}
      </p>}
    </div>
    {renderVersionTools()}
  </div>;

  const rosterSize = projected => projected ? Object.values(projected.by_position_count || {}).reduce((sum, n) => sum + n, 0) : null;
  const teamFirstName = teamId => {
    const parts = hubTeamParts(teamById[teamId]);
    return (parts.owner || parts.team || teamName(teamId)).split(/\s+/)[0];
  };
  const legWeekPoints = leg => (weekEligible && !leg.deadCap ? tradeWeekPlayerPoints(leg.player_id, weekCards) : null);
  const legFlowText = (leg, { multi }) => leg.deadCap
    ? `${teamName(leg.from)} → ${teamName(leg.to)}`
    : multi && !leg.drop ? (leg.from === myTeamId ? `→ ${teamName(leg.to)}` : `← ${teamName(leg.from)}`) : "";
  const legKey = leg => `${leg.drop ? "cut" : leg.deadCap ? "dead" : "send"}-${leg.from}-${leg.player_id}`;

  const renderWeekFigure = (cls = "") => {
    const weekAvailable = hasPackage && weekEligible && myWeekPreview.available;
    return <div className={`hub-trade-figure ${cls}`}><span>{formatCopy.yourStarters}{weekPayload?.meta?.week ? ` · ${formatCopy.weekLabel(weekPayload.meta.week)}` : ""}</span>
      <strong className={weekAvailable ? `is-${tradeWeekTone(myWeekPreview.delta)}` : ""}>
        {weekAvailable ? `${myWeekPreview.delta > 0 ? "+" : ""}${myWeekPreview.delta.toFixed(1)}` : "—"}
      </strong><small>{weekAvailable ? `${myWeekPreview.before_p50.toFixed(1)} → ${myWeekPreview.after_p50.toFixed(1)} · ${formatCopy.pprEstimate}`
        : !weekEligible ? formatCopy.weekClosed : !hasPartner ? formatCopy.weekSelect
          : !hasPackage ? formatCopy.emptyAction
            : weekState.status === "idle" ? formatCopy.weekLoading : weekEmptyCopy}</small></div>;
  };

  const renderExchangeFigures = () => {
    const mine = projectedByTeam[myTeamId];
    const partner = projectedByTeam[partnerTeamIds[0]];
    return <div className="hub-trade-exchange-result">
      {renderWeekFigure()}
      <div className="hub-trade-figure"><span>{salaryLeague ? formatCopy.yourCap : formatCopy.yourRoster}</span><strong>
        {salaryLeague ? fmtSal(mine?.unspent) : rosterSize(mine) ?? "—"}
      </strong><small>{salaryLeague ? formatCopy.beforeValue(fmtSal(mine?.base?.unspent)) : formatCopy.rosterBalance}</small></div>
      <div className="hub-trade-figure hub-trade-figure-partner"><span>{salaryLeague ? formatCopy.partnerCap : formatCopy.partnerRoster}</span><strong>
        {salaryLeague ? fmtSal(partner?.unspent) : rosterSize(partner) ?? "—"}
      </strong><small>{hasPartner ? teamName(partnerTeamIds[0]) : formatCopy.partnerNeeded}</small></div>
    </div>;
  };

  const renderExchangeLeg = (legs, { title, empty, cls, multi }) => <div className={`hub-trade-exchange-leg ${cls}`}>
    <p className="hub-trade-exchange-eyebrow">{title}</p>
    {legs.length ? legs.map(leg => <TradeDealRow key={legKey(leg)} leg={leg} row={rowByPlayer[leg.player_id]} media={media} salaryLeague={salaryLeague}
      weekP50={legWeekPoints(leg)} flow={legFlowText(leg, { multi })} onRemove={() => removePackageLeg(leg)} copy={formatCopy} busy={Boolean(busy)} />)
      : empty ? <p className="hub-trade-deal-empty">{empty}</p> : null}
  </div>;

  const renderExchange = () => {
    const outgoing = packageLegs.filter(leg => leg.from === myTeamId);
    const incoming = packageLegs.filter(leg => leg.to === myTeamId);
    const otherMoves = packageLegs.filter(leg => leg.from !== myTeamId && leg.to !== myTeamId);
    const multi = activeParties.length > 2;
    const partnerName = hasPartner ? teamFirstName(partnerTeamIds[0]) : "";
    const ledgerLeg = leg => { const row = rowByPlayer[leg.player_id]; return { salary: leg.salary, years: row?.contract_years ?? row?.contract?.years_remaining, weekP50: legWeekPoints(leg) }; };
    const ledger = tradeExchangeLedger({ out: outgoing.filter(leg => !leg.deadCap).map(ledgerLeg), incoming: incoming.filter(leg => !leg.deadCap).map(ledgerLeg),
      salaryLeague, weekAvailable: weekEligible && weekState.status === "ready", copy: formatCopy });
    return <section className="hub-trade-exchange" aria-label={formatCopy.exchangeTitle}>
      <header className="hub-trade-exchange-head"><h2>{formatCopy.exchangeTitle}</h2><span className="hub-trade-exchange-live">{formatCopy.exchangeLive}</span></header>
      {renderExchangeLeg(outgoing, { title: hasPartner && !multi ? formatCopy.youSendTo(partnerName) : formatCopy.youSend, empty: formatCopy.pickFromYours, cls: "is-out", multi })}
      <span className="hub-trade-swap" aria-hidden="true">⇄</span>
      {renderExchangeLeg(incoming, { title: hasPartner && !multi ? formatCopy.youReceiveFrom(partnerName) : formatCopy.youReceive,
        empty: hasPartner ? formatCopy.pickFromTheirs(partnerName) : formatCopy.partnerNeeded, cls: "is-in", multi })}
      {otherMoves.length > 0 && renderExchangeLeg(otherMoves, { title: formatCopy.betweenPartners, empty: "", cls: "is-other", multi: true })}
      {ledger.length > 0 && <dl className="hub-trade-ledger">
        <div className="hub-trade-ledger-key" aria-hidden="true"><dt /><dd><span>{formatCopy.ledgerOut}</span><span>{formatCopy.ledgerIn}</span></dd></div>
        {ledger.map(row => <div key={row.label}><dt>{row.label}</dt><dd>
          <span><span className="sr-only">{formatCopy.ledgerOut} </span>{row.out}</span>
          <span><span className="sr-only">{formatCopy.ledgerIn} </span>{row.in}</span>
        </dd></div>)}
      </dl>}
      {renderExchangeFigures()}
      {renderDecision()}
      <button type="button" className="btn-link hub-trade-exchange-more" onClick={() => setDialog("impact")} disabled={!myTeamId}>{formatCopy.fullImpact} ↗</button>
    </section>;
  };

  const renderDuelHalf = ({ teamId, legs, projected, status, cls, multi }) => {
    const isYou = teamId === myTeamId;
    const before = projected?.base;
    return <div key={teamId} className={`hub-trade-duel-half ${cls}`}>
      <TradeTeamArt identity={identityForTeam(teamId)} />
      <TradeTeamHead team={teamById[teamId]} identity={identityForTeam(teamId)} isYou={isYou} copy={formatCopy}>
        {status && <span className={`hub-trade-pill is-${status.tone}`}>{status.text}</span>}
      </TradeTeamHead>
      <p className="hub-trade-exchange-eyebrow">{formatCopy.sendsLabel}</p>
      <div className="hub-trade-duel-rows">
        {legs.length ? legs.map(leg => <TradeDealRow key={legKey(leg)} leg={leg} row={rowByPlayer[leg.player_id]} media={media} salaryLeague={salaryLeague}
          weekP50={legWeekPoints(leg)} flow={legFlowText(leg, { multi })} copy={formatCopy} />)
          : <p className="hub-trade-deal-empty">{formatCopy.nothingSent}</p>}
      </div>
      {projected && <footer className="hub-trade-duel-foot">
        {salaryLeague && <span>{formatCopy.capRoomLabel} {fmtSal(before?.unspent)} → <strong className={projected.unspent < 0 ? "is-blocking" : ""}>{fmtSal(projected.unspent)}</strong></span>}
        <span>{formatCopy.rosterLabel} {rosterSize(before) === rosterSize(projected) ? rosterSize(projected) : <>{rosterSize(before)} → <strong>{rosterSize(projected)}</strong></>}</span>
      </footer>}
    </div>;
  };

  const renderDuel = ({ parties: list, legsFor, projectedFor, statusFor, center, label }) => {
    const mine = list.find(p => p.team_id === myTeamId);
    const others = list.filter(p => p.team_id !== myTeamId);
    const left = mine || others[0];
    const right = mine ? others : others.slice(1);
    const multi = list.length > 2;
    const half = (party, cls) => party && renderDuelHalf({ teamId: party.team_id, legs: legsFor(party), projected: projectedFor?.(party), status: statusFor?.(party), cls, multi });
    return <section className={`hub-trade-duel${right.length > 1 ? " is-multi" : ""}`} aria-label={label}>
      {half(left, "is-you")}
      <div className="hub-trade-duel-center">{center}</div>
      <div className="hub-trade-duel-partners">{right.map(party => half(party, "is-them"))}</div>
    </section>;
  };

  const renderReviewCenter = () => <>
    <span className="hub-trade-swap hub-trade-swap-large" aria-hidden="true">⇄</span>
    {renderWeekFigure("hub-trade-figure-duel")}
    {renderDecision()}
  </>;

  const renderMoveChip = leg => <button type="button" key={`${leg.from}-${leg.player_id}`} className={`hub-trade-move-chip${leg.drop ? " is-cut" : ""}`}
    disabled={Boolean(busy)} onClick={() => removePackageLeg(leg)} aria-label={formatCopy.removeMove(leg.name)}
    title={`${leg.drop ? formatCopy.cutVerb + " · " : leg.deadCap ? formatCopy.dead + " · " : ""}${leg.name}`}>
    <span>{leg.drop ? `${formatCopy.cutVerb} · ` : leg.deadCap ? `${fmtSal(leg.amount)} ${formatCopy.dead} · ` : ""}{leg.name}</span>
    <span aria-hidden="true">×</span>
  </button>;

  const renderEditablePackage = () => <div className="hub-trade-package-editor">
    {packageLegs.length ? packageLegs.map(leg => <div key={`${leg.from}-${leg.player_id}`} className="hub-trade-edit-move">
      <div><strong>{leg.name}</strong><p>{leg.deadCap
        ? formatCopy.deadCapFlow(leg.name, fmtSal(leg.amount), teamName(leg.from), teamName(leg.to))
        : packageLegFlow(leg, teamName, formatCopy.cutVerb)}</p></div>
      <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={() => removePackageLeg(leg)} aria-label={formatCopy.removeMove(leg.name)}>×</button>
    </div>) : <p>{formatCopy.noPackageYet}</p>}
  </div>;

  const renderDeskBar = () => {
    const outgoing = packageLegs.filter(leg => leg.from === myTeamId);
    const incoming = packageLegs.filter(leg => leg.to === myTeamId);
    const otherMoves = packageLegs.filter(leg => leg.from !== myTeamId && leg.to !== myTeamId);
    const capChange = salaryLeague ? tradeCapChangeText(projectedByTeam[myTeamId]?.base?.unspent, projectedByTeam[myTeamId]?.unspent) : null;
    return <div data-bottom-actions className="hub-trade-desk-bar hub-mobile-action-panel" ref={deskBarRef}>
      <div className="hub-trade-package-mini hub-mobile-action-panel__summary" aria-label={formatCopy.packageTitle}>
        {[{ label: formatCopy.youSend, legs: outgoing }, { label: formatCopy.youReceive, legs: incoming }].map(side =>
          <div key={side.label}><div className="hub-trade-mini-label hub-mobile-action-panel__label"><span>{side.label}</span><span>{side.legs.length}</span></div>
            <div className="hub-trade-chip-track hub-mobile-action-panel__detail">{side.legs.length ? <>{renderMoveChip(side.legs[0])}
              {side.legs.length > 1 && <button type="button" className="btn-link hub-trade-more-moves" onClick={() => setDialog("package")}
                aria-label={formatCopy.viewMoves(packageLegs.length)}>{formatCopy.moreMoves(side.legs.length - 1)}</button>}</> : <span className="hub-trade-empty-chip">—</span>}</div>
          </div>)}
        <button type="button" className="btn-ghost hub-mobile-action-panel__more" aria-label={formatCopy.viewMoves(packageLegs.length)} disabled={!hasPackage} onClick={() => setDialog("package")}>…</button>
      </div>
      <div className="hub-trade-bar-status hub-mobile-action-panel__status">
        {hasPackage ? <div className="hub-trade-action-status">
          {proposalError ? <HubAlert variant="danger" role="alert">{proposalError}</HubAlert>
            : <TradeVerdict status={validationStatus} errors={validationErrors} message={validationMessage} compact copy={formatCopy} />}
          {validationRetryable && !proposalError && <button type="button" className="btn-link"
            onClick={() => setValidationAttempt(attempt => attempt + 1)}>{formatCopy.retryCheck}</button>}
        </div>
          : <span className="hub-trade-bar-hint">{!otherTeams.length ? formatCopy.noPartners : !hasPartner ? formatCopy.partnerNeeded : formatCopy.emptyAction}</span>}
        {capChange && <span className="hub-trade-net-cap" aria-label={`${formatCopy.netCap}: ${capChange}`}><span className="hub-trade-net-cap-prefix">{formatCopy.netCap}</span><strong>{capChange}</strong><span className="hub-trade-net-cap-suffix" aria-hidden="true">{formatCopy.capShort}</span></span>}
        {otherMoves.length > 0 && <button type="button" className="btn-link" onClick={() => setDialog("package")}>{formatCopy.otherMoves(otherMoves.length)}</button>}
        {lastRemoved && <button ref={dialog === "package" ? null : undoRef} type="button" className="btn-link" aria-label={formatCopy.undoRemoveLabel}
          disabled={Boolean(busy)} onClick={() => { undoPackageRemoval(); builderSearchRef.current?.focus({ preventScroll: true }); }}>{formatCopy.undoRemove}</button>}
      </div>
      {!otherTeams.length ? <button type="button" className="btn-ghost" disabled={!myTeamId} onClick={() => onNavigate?.("office-members")}>{formatCopy.inviteManagers}</button>
        : !hasPartner ? <button type="button" className="btn-ghost" disabled={!myTeamId} onClick={() => openPartnerPicker()}>{formatCopy.choosePartner}</button>
          : builderStep === "review" ? <button type="button" className="btn-primary" disabled={!canPropose} onClick={propose}>
            {busy === "propose" ? formatCopy.proposing : formatCopy.proposeTrade}</button>
            : <button type="button" className="btn-primary" disabled={!canPropose} onClick={() => goBuilderStep("review")}>{formatCopy.reviewTrade} →</button>}
    </div>;
  };

  return (
    <PlayerCardReadScope context={weekPayload?.meta}>
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
            resetComparison(); setSourceReviewId(null); setParties([emptyParty(myTeamId), emptyParty(id)]); setDeadCapAssignments([]);
            setProposeNote(""); setSearch(""); setPosFilter("ALL"); pendingBuilderFocus.current = true;
            setTab("builder"); setBuilderStep("players"); setPhoneView("receive");
          }} />
      </section>}
      {tab === "builder" && !loading && loadedLeague === leagueId && <div className="hub-trade-builder" id="trades-panel-builder">
        {!myTeamId ? <HubAlert variant="info">{formatCopy.teamNeeded}</HubAlert> : <>
          {builderStep !== "review" ? <div className="hub-trade-workspace" data-phone-view={phoneView}>
            {!sourceReviewId && otherTeams.length > 0 && <div className="hub-trade-phone-partner">
              <span>{formatCopy.tradePartner}</span>
              <button type="button" className="btn-ghost" onClick={() => openPartnerPicker()}
                aria-label={hasPartner ? formatCopy.partnerButton(teamName(partnerTeamIds[0])) : formatCopy.choosePartner}>
                <span>{hasPartner ? teamName(partnerTeamIds[0]) : formatCopy.choosePartner}</span><span aria-hidden="true">▾</span>
              </button>
            </div>}
            <nav className="hub-trade-phone-views" aria-label={formatCopy.buildTab}>
              {[["send", formatCopy.sendView, formatCopy.youSend], ["receive", formatCopy.receiveView, formatCopy.youReceive], ["exchange", formatCopy.exchangeView, formatCopy.exchangeTitle]].map(([id, label, aria]) =>
                <button key={id} type="button" aria-label={aria} aria-pressed={phoneView === id} onClick={() => setPhoneView(id)}>{label}
                  {id !== "exchange" && <span className="hub-trade-view-count" aria-hidden="true">{packageLegs.filter(leg => id === "send" ? leg.from === myTeamId : leg.to === myTeamId).length}</span>}</button>)}
            </nav>
            {(packageHeadline || otherDraft) && <div className="hub-trade-phone-decision">{renderDecision()}</div>}
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
                {advanced && !sourceReviewId && <button type="button" className="btn-ghost" onClick={() => openPartnerPicker(true)}>{formatCopy.addPartners}</button>}
                {weekEligible && weekPayload?.meta?.week && <span className="hub-trade-week-basis">{formatCopy.weekLabel(weekPayload.meta.week)} · {formatCopy.pprEstimate}</span>}
              </div>
            </div>
          </div> : <section className="hub-trade-review" ref={reviewRef} tabIndex={-1} aria-label={formatCopy.reviewHeading}>
            <header><h2>{formatCopy.reviewHeading}</h2><button type="button" className="btn-link" onClick={() => goBuilderStep("players")}>← {formatCopy.editPackage}</button></header>
            {renderDuel({ parties: activeParties, legsFor: party => packageLegs.filter(leg => leg.from === party.team_id),
              projectedFor: party => projectedByTeam[party.team_id], center: renderReviewCenter(), label: formatCopy.tradeReview })}
            <div className="hub-trade-review-grid">
              <div className="hub-trade-note-card">
                <label className="hub-trade-note-label" htmlFor="trade-propose-note">{formatCopy.proposeNoteLabel}</label>
                <textarea id="trade-propose-note" className="hub-trade-note" rows={4} value={proposeNote}
                  onChange={e => setProposeNote(e.target.value)} placeholder={formatCopy.proposeNotePlaceholder} />
              </div>
              <section className="hub-trade-next"><h3>{formatCopy.afterProposal}</h3><p>{sourceReviewId ? formatCopy.capAgreementNotifyLine : sleeperLinked ? formatCopy.sleeperNotifyLine : formatCopy.nativeNext}</p>
                {sleeperLinked && <p>{formatCopy.sleeperSupport}</p>}<p>{formatCopy.whatsNext} {formatCopy.privateWeek}</p></section>
            </div>
            <details className="hub-trade-review-disclosure">
              <summary>{formatCopy.fullImpact}</summary>
              {renderPackageSummary()}{renderFullImpact()}
            </details>
          </section>}
          {renderDeskBar()}
        </>}
      </div>}
      {dialog && <TradeDeskDialog title={dialog === "partner" ? formatCopy.pickPartnerTitle : dialog === "package" ? formatCopy.editPackage : formatCopy.fullImpact} onClose={() => setDialog(null)}>
        {dialog === "partner" ? <>{renderPartnerCards()}<button type="button" className="btn-ghost" onClick={() => setDialog(null)}>{formatCopy.doneChoosing}</button></> : dialog === "package" ? <>{renderEditablePackage()}
          {lastRemoved && <button ref={undoRef} type="button" className="btn-link" aria-label={formatCopy.undoRemoveLabel}
            disabled={Boolean(busy)} onClick={undoPackageRemoval}>{formatCopy.undoRemove}</button>}</> : renderFullImpact()}
      </TradeDeskDialog>}

      {tab === "inbox" && !secondaryLoading && !secondaryError.inbox && (
        <div className="hub-trade-inbox" id="trades-panel-inbox">
          {proposals.length === 0 && (
            <div className="hub-insights-empty-state">
              <h3>{formatCopy.inboxEmptyHeading}</h3>
              <p>{formatCopy.inboxEmpty}</p>
            </div>
          )}
          {proposals.map((p) => {
            const partyList = p.parties || [];
            const legs = buildLegs(partyList);
            const isParty = partyList.some(x => x.team_id === myTeamId);
            const mineIsPending = isParty && (p.acceptances?.[myTeamId] || "pending") === "pending" && p.status === "pending";
            const projectable = ["pending", "awaiting_sleeper"].includes(p.status);
            const projectedFor = party => projectable ? projectTeamTradeStats({ teamId: party.team_id, statsByTeam, rosterByTeam, rowByPlayer,
              parties: partyList, deadCapAssignments: p.dead_cap_assignments || [], rules, salaryCap: capLimit }) : null;
            const preview = weekStripReady && mineIsPending ? inboxWeekPreview(p) : null;
            const status = tradeProposalStatus(p.status, { yourResponsePending: mineIsPending, copy: formatCopy });
            // Proposals open with only the proposer accepted; once others accept, the first party is the builder's own team.
            const accepted = partyList.filter(x => p.acceptances?.[x.team_id] === "accepted");
            const proposer = accepted.length === 1 ? accepted[0] : partyList[0];
            const headline = mineIsPending ? tradePackageHeadline({ parties: partyList, myTeamId, projected: projectedFor({ team_id: myTeamId }),
              weekPreview: weekEligible ? preview : null, rules, salaryLeague }) : null;
            return <article key={p.id} className="hub-trade-proposal">
              <p className="hub-trade-proposal-kicker">
                <strong>{proposer?.team_id === myTeamId ? formatCopy.you : teamName(proposer?.team_id)}</strong>
                {" "}{formatCopy.proposedVerb}
                {p.note ? <span className="hub-trade-proposal-note"> · “{p.note}”</span> : null}
              </p>
              {renderDuel({ parties: partyList, legsFor: party => legs.filter(leg => leg.from === party.team_id), projectedFor,
                statusFor: party => tradeAcceptanceLabel(p.acceptances?.[party.team_id] || "pending", { isYou: party.team_id === myTeamId && mineIsPending, copy: formatCopy }),
                label: `${formatCopy.tradeReview}: ${partyList.map(x => teamName(x.team_id)).join(" · ")}`,
                center: <>
                  <span className="hub-trade-swap hub-trade-swap-large" aria-hidden="true">⇄</span>
                  {preview?.available && <div className="hub-trade-figure hub-trade-figure-duel"><span>{formatCopy.yourStarters}{weekPayload?.meta?.week ? ` · ${formatCopy.weekLabel(weekPayload.meta.week)}` : ""}</span>
                    <strong className={`is-${tradeWeekTone(preview.delta)}`}>{preview.delta > 0 ? "+" : ""}{preview.delta.toFixed(1)}</strong>
                    <small>{preview.before_p50.toFixed(1)} → {preview.after_p50.toFixed(1)} · {formatCopy.privateNote}</small></div>}
                  {preview && !preview.available && <p className="hub-trade-deal-empty">{weekEmptyCopy}</p>}
                  {headline && <p className={`hub-trade-headline is-${headline.tone}`}>{headline.text}</p>}
                  <span className={`hub-trade-pill is-${status.tone}`}>{status.text}</span>
                </> })}
              <div className="hub-insights-suggestion-actions hub-trade-proposal-actions">
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
                    <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => respond(p.id, true)}>{formatCopy.acceptAction}</button>
                    <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => respond(p.id, false)}>{formatCopy.rejectAction}</button>
                  </>
                )}
                {p.status !== "cap_review" && (isCommissioner || isParty) && (
                  <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => cancelProp(p.id)}>{formatCopy.cancelAction}</button>
                )}
                {isCommissioner && p.status === "pending" && !sleeperLinked && (
                  <button type="button" className="btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => forceApply(p.id)}>{formatCopy.forceApplyAction}</button>
                )}
              </div>
            </article>;
          })}
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
    </PlayerCardReadScope>
  );
}
