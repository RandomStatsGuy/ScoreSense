import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useMobileLayout from "../useMobileLayout";
import MobileSubnav from "../layout/MobileSubnav";
import { apiFetch, getToken } from "../auth";
import { parseApiError } from "../format";
import { pickFantasyMediaDigest } from "../fantasyMediaDigest";
import DraftNomineeCard from "./DraftNomineeCard";
import DraftRosterPanel from "./DraftRosterPanel";
import DraftTeamCard from "./DraftTeamCard";
import DraftPickRecap from "./DraftPickRecap";
import DraftRecapPanel from "./DraftRecapPanel";
import DraftOwnerReport from "./DraftOwnerReport";
import DraftTradeModal from "./DraftTradeModal";
import DraftEntryPanel from "./DraftEntryPanel";
import DraftNominationQueue from "./DraftNominationQueue";
import LeagueChat from "./LeagueChat";
import ValueSheetTable from "./ValueSheetTable";
// Explicit extension avoids colliding with snakeDraftBoard.js on Windows.
import SnakeDraftBoard from "./SnakeDraftBoard.jsx";
import { confirmDialog } from "../ui/confirm";
import DraftDeadlineClock from "./DraftDeadlineClock";
import DraftLiveCommandBar from "./DraftLiveCommandBar";
import DraftOverflowMenu from "./DraftOverflowMenu";
import {
  viewerIsCommissioner,
  nextNominator,
  nextOnClock,
  formatPickTracker,
  loadWatchIds,
  toggleWatchId,
  teamBudgetLine,
  isLiveAuctionStatus,
  shouldApplyRoomState,
  mergeRoomState,
  shouldScheduleWsReconnect,
} from "./draftLiveConsole";
import { isPickDraft } from "./draftEntryStatus";
import { HubPage } from "./HubUILayout";
import { isRowAvailable } from "./valueSheetUtils";
import {
  buildRosterCapacity,
  canAcquireAtPosition,
  completedDraftReviewTarget,
  formatDraftEvent,
  isRetainedThroughDraft,
  minNextBid,
  unmetMinPositions,
} from "./draftRoomHelpers";
import { fmtSal } from "./rosterFormat";
import {
  effectiveAuctionBid,
  formatRaavDelta,
  isRiskToleranceActive,
  raavDelta,
} from "../riskAdjustedValue";
import { formatSeasonPts } from "../seasonQuantiles";

function draftPhaseStep(status) {
  if (status === "bidding") return 2;
  if (status === "completed") return 3;
  if (status === "nominating" || status === "picking") return 1;
  return 0;
}

function DraftOnClockPanel({
  pickDraft,
  isMyTurn,
  nominatorName,
  pickClock,
  nextTeam,
  deadline,
  paused,
}) {
  const title = isMyTurn
    ? (pickDraft ? "You're on the clock" : "Your nomination")
    : `On the clock: ${nominatorName || "a team"}`;
  const tracker = formatPickTracker(pickClock, { nextTeam });
  return (
    <div className={`hub-draft-on-clock${isMyTurn ? " is-yours" : ""}`} role="status">
      <div className="hub-draft-on-clock-main">
        <strong>{title}</strong>
        {tracker ? <span className="chart-note">{tracker}</span> : null}
      </div>
      {deadline ? (
        <DraftDeadlineClock deadline={deadline} paused={paused} className="hub-draft-live-timer" />
      ) : null}
    </div>
  );
}

export default function DraftRoom({
  leagueId,
  onLeagueIdChange,
  onLeagueJoined,
  valueRows,
  valueSheetLoading = false,
  hubRoster: _hubRoster = [],
  season,
  hubContext = null,
  onNavigate,
  toolMode = false,
  toolLabel = "",
  onExitRoom,
}) {
  const [roomState, setRoomState] = useState(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [bidAmount, setBidAmount] = useState("");
  const [nomPlayerId, setNomPlayerId] = useState("");
  const [mockModeLabel, setMockModeLabel] = useState("");
  const [sandboxSourceLeagueId, setSandboxSourceLeagueId] = useState("");
  const [expirePreview, setExpirePreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [boardOpen, setBoardOpen] = useState(true);
  const [enrichment, setEnrichment] = useState(null);
  const [fantasyMediaDigests, setFantasyMediaDigests] = useState({});
  const [digestLoadingId, setDigestLoadingId] = useState(null);
  const [pickRecap, setPickRecap] = useState(null);
  const [draftRecap, setDraftRecap] = useState(null);
  const [nominationPoolRows, setNominationPoolRows] = useState(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [tradeModal, setTradeModal] = useState(null);
  const [pendingTradeCount, setPendingTradeCount] = useState(0);
  const mobileLayout = useMobileLayout();
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [railTab, setRailTab] = useState("roster");
  const [watchIds, setWatchIds] = useState([]);
  const wsAliveRef = useRef(false);
  const wsGenRef = useRef(0);
  const wsReconnectTimerRef = useRef(null);
  const roomFetchGenRef = useRef(0);
  const [mobilePanel, setMobilePanel] = useState(() => {
    if (typeof sessionStorage === "undefined") return "auction";
    return sessionStorage.getItem("scoresense-draft-mobile-panel") || "auction";
  });
  const setMobilePanelPersist = useCallback((panel) => {
    setMobilePanel(panel);
    try {
      sessionStorage.setItem("scoresense-draft-mobile-panel", panel);
    } catch {
      /* ignore */
    }
  }, []);
  const wsRef = useRef(null);
  const bidTouched = useRef(false);
  const bidFocused = useRef(false);
  const myTeamIdRef = useRef(null);
  const lastWinEventIdRef = useRef(null);
  const timerExpiredRef = useRef(false);

  const session = roomState?.session;
  const league = roomState?.league;
  const rules = league?.rules;
  const pickDraft = isPickDraft(rules) || ["snake", "linear"].includes(String(roomState?.draft_type || ""));
  const pickClock = roomState?.pick || null;
  const relaxLimits = Boolean(rules?.relax_salary_roster_limits || roomState?.limits_relaxed);
  const nominee = session?.current_nominee;
  const teams = roomState?.teams || [];
  const events = roomState?.events || [];
  const pickEvents = (Array.isArray(roomState?.picks) && roomState.picks.length)
    ? roomState.picks
    : events;

  const suggestedBid = useMemo(() => minNextBid(session, rules), [session, rules]);
  const highBidder = useMemo(
    () => teams.find((t) => t.id === session?.high_bidder_team_id),
    [teams, session?.high_bidder_team_id],
  );
  const cap = Number(rules?.salary_cap ?? 200);
  const poolMode = roomState?.pool_mode || session?.pool_mode || "full";

  useEffect(() => {
    if (roomState?.viewer?.team_id) myTeamIdRef.current = roomState.viewer.team_id;
  }, [roomState?.viewer?.team_id]);

  const myTeamId = roomState?.viewer?.team_id || myTeamIdRef.current;
  const myRoster = useMemo(() => {
    if (myTeamId && roomState?.rosters?.[myTeamId]) return roomState.rosters[myTeamId];
    return roomState?.viewer?.roster || [];
  }, [myTeamId, roomState?.rosters, roomState?.viewer?.roster]);

  const posCapacity = useMemo(
    () => buildRosterCapacity(rules, myRoster, {
      draftCompleted: Boolean(league?.draft_completed) || session?.status === "completed",
      relaxLimits,
    }),
    [rules, myRoster, league?.draft_completed, session?.status, relaxLimits],
  );
  const needPositions = useMemo(() => unmetMinPositions(posCapacity), [posCapacity]);

  const viewerPanel = useMemo(() => {
    if (!myTeamId && !roomState?.viewer) return null;
    const team = teams.find((t) => t.id === myTeamId);
    return {
      team_id: myTeamId,
      team_name: team?.name || roomState?.viewer?.team_name || "My roster",
      roster: myRoster,
      capacity: { by_position: posCapacity },
    };
  }, [myTeamId, myRoster, posCapacity, roomState?.viewer, teams]);

  const draftedIds = useMemo(() => {
    const ids = new Set();
    const draftDone = Boolean(league?.draft_completed) || session?.status === "completed";
    Object.values(roomState?.rosters || {}).forEach((rows) => {
      (rows || []).forEach((r) => {
        if (r.player_id && isRetainedThroughDraft(r, draftDone)) ids.add(r.player_id);
      });
    });
    return ids;
  }, [roomState?.rosters, league?.draft_completed, session?.status]);

  const testMode = Boolean(league?.test_mode);

  const clientAvailableRows = useMemo(() => {
    const drafted = draftedIds;
    return (valueRows || []).filter((r) => {
      if (!r.player_id || drafted.has(r.player_id)) return false;
      // Keeper pool: anyone not retained (expirees, FA, undrafted rookies).
      if (poolMode === "roster_plus_rookies") return true;
      // Mock drafts start from empty rosters: the sheet's is_available reflects
      // the linked real league's rosters, so only in-draft picks exclude players.
      if (!testMode && !isRowAvailable(r)) return false;
      return true;
    });
  }, [valueRows, draftedIds, poolMode, testMode]);

  // Prefer client-side filtering of the cached value sheet; server pool rows
  // are a fallback for cold sheets and get drafted players filtered per pick.
  const hasValueRows = Boolean(valueRows?.length);
  const availableRows = useMemo(() => {
    if (!hasValueRows && nominationPoolRows != null && nominationPoolRows.length > 0) {
      return nominationPoolRows.filter((r) => !r.player_id || !draftedIds.has(r.player_id));
    }
    return clientAvailableRows;
  }, [hasValueRows, nominationPoolRows, clientAvailableRows, draftedIds]);

  const boardLoading = poolLoading || (availableRows.length === 0 && valueSheetLoading);

  const draftedCount = draftedIds.size;

  const nominatePool = availableRows;

  const canAcquire = useCallback(
    (position) => canAcquireAtPosition(posCapacity, position, { relaxLimits }),
    [posCapacity, relaxLimits],
  );

  const isCommissioner = useMemo(
    () => viewerIsCommissioner({
      hubContext,
      viewer: roomState?.viewer,
      myTeam: teams.find((t) => t.id === myTeamId),
    }),
    [hubContext, roomState?.viewer, teams, myTeamId],
  );

  const draftStatus = session?.status
    || (league?.draft_completed
      ? "completed"
      : league?.status === "live"
        ? "nominating"
        : "setup");
  const inDraftSetup = draftStatus === "setup";
  const draftCompleted = draftStatus === "completed" || Boolean(league?.draft_completed);
  const inLiveDraft = isLiveAuctionStatus(draftStatus);
  const onClock = draftStatus === "nominating" || draftStatus === "picking";
  const recapHasStory = Boolean(
    draftRecap && (
      (draftRecap.awards?.length ?? 0) > 0
      || (draftRecap.notable_picks?.length ?? 0) > 0
      || (draftRecap.projected_standings?.length ?? 0) > 0
      || draftRecap.pick_draft
    ),
  );
  const completedReview = completedDraftReviewTarget(pickDraft);
  const hasCompletedReview = pickDraft
    ? Boolean(recapHasStory && draftRecap)
    : teams.length > 0;
  const linkedHubLeagueId = hubContext?.league_id || "";
  const usingHubLeague = Boolean(leagueId && linkedHubLeagueId && leagueId === linkedHubLeagueId);
  const showDraftEntry = !toolMode && !inLiveDraft && !draftCompleted;
  const nominatorTeamId = roomState?.nominator_team_id;
  const nominatorTeam = useMemo(
    () => teams.find((t) => String(t.id) === String(nominatorTeamId)),
    [teams, nominatorTeamId],
  );
  const isMyNominationTurn = !nominatorTeamId
    || String(myTeamId) === String(nominatorTeamId);
  const nextClockTeam = useMemo(
    () => (pickDraft
      ? nextOnClock(session, teams, roomState?.draft_type || rules?.draft_type)
      : nextNominator(session, teams)),
    [pickDraft, session, teams, roomState?.draft_type, rules?.draft_type],
  );
  const pickTracker = formatPickTracker(pickClock, { nextTeam: nextClockTeam });
  const canForceNominate = Boolean(
    !testMode
    && isCommissioner
    && (session?.status === "nominating" || session?.status === "picking")
    && !session?.paused
    && nominatorTeamId
    && String(myTeamId) !== String(nominatorTeamId),
  );

  const sentimentByPlayerId = enrichment?.sentiment_by_player_id || {};
  const mediaByPlayerId = enrichment?.media_by_player_id || {};
  const sentimentMeta = enrichment
    ? {
        season: enrichment.season,
        week: enrichment.week,
        requested_season: enrichment.requested_season,
        requested_week: enrichment.requested_week,
        context_fallback: enrichment.context_fallback,
        media_context: enrichment.media_context,
      }
    : null;

  const playerContext = useCallback(
    (playerId, row) => {
      if (!playerId) {
        return {
          sentiment: null,
          headshotUrl: null,
          teamLogoUrl: null,
          fantasyMediaDigest: null,
        };
      }
      const media = mediaByPlayerId[playerId] || {};
      const sentiment = sentimentByPlayerId[playerId] || null;
      return {
        sentiment,
        headshotUrl: media.headshot_url || null,
        teamLogoUrl: media.team_logo_url || null,
        fantasyMediaDigest:
          fantasyMediaDigests[playerId] || pickFantasyMediaDigest(sentiment) || null,
      };
    },
    [mediaByPlayerId, sentimentByPlayerId, fantasyMediaDigests],
  );

  // Key on the stable id list so a new valueRows array identity with the same
  // players does not re-POST enrichment for up to 400 rows.
  const valueRowsRef = useRef(valueRows);
  valueRowsRef.current = valueRows;
  const enrichmentIdsKey = useMemo(
    () => (valueRows || []).slice(0, 400).map((r) => r.player_id).filter(Boolean).join(","),
    [valueRows],
  );

  useEffect(() => {
    if (!season || !enrichmentIdsKey || testMode) return;
    const players = (valueRowsRef.current || []).slice(0, 400).map((r) => ({
      player_id: r.player_id,
      player_name: r.player,
      team: r.team,
      position: r.position,
    })).filter((r) => r.player_id);
    if (!players.length) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/hub/draft-room/enrichment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ season, players }),
        });
        if (!res.ok || cancelled) return;
        setEnrichment(await res.json());
      } catch {
        if (!cancelled) setEnrichment(null);
      }
    })();
    return () => { cancelled = true; };
  }, [season, enrichmentIdsKey, testMode]);

  useEffect(() => {
    if (!mobileLayout) setBoardOpen(true);
  }, [mobileLayout]);

  useEffect(() => {
    if (testMode && inLiveDraft) setEnrichment(null);
  }, [testMode, inLiveDraft]);

  useEffect(() => {
    if (league && !league.test_mode) {
      setMockModeLabel("");
    }
  }, [league?.test_mode, league?.id]);

  useEffect(() => {
    if (toolMode && toolLabel) setMockModeLabel(toolLabel);
  }, [toolMode, toolLabel]);

  useEffect(() => {
    if (!usingHubLeague || !leagueId || !isCommissioner) {
      if (!testMode) setExpirePreview(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/hub/league/${leagueId}/draft-expire-preview`);
        if (!res.ok || cancelled) return;
        setExpirePreview(await res.json());
      } catch {
        if (!cancelled) setExpirePreview(null);
      }
    })();
    return () => { cancelled = true; };
  }, [usingHubLeague, leagueId, isCommissioner, testMode]);

  // Server nomination pool is only needed when the value sheet is cold; each
  // fetch runs a full build_value_sheet server-side, so avoid per-pick refetches.
  useEffect(() => {
    if (!leagueId || hasValueRows) {
      setNominationPoolRows(null);
      setPoolLoading(false);
      return undefined;
    }
    let cancelled = false;
    setPoolLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/hub/league/${leagueId}/nomination-pool`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setNominationPoolRows(data.rows || []);
      } catch {
        if (!cancelled) setNominationPoolRows(null);
      } finally {
        if (!cancelled) setPoolLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId, hasValueRows, poolMode]);

  const allowMidDraftCuts = Boolean(rules?.auction?.allow_mid_draft_cuts);

  const myTeam = useMemo(
    () => teams.find((t) => t.id === myTeamId),
    [teams, myTeamId],
  );

  // Rail shows other teams in nomination order (viewer's team is pinned above).
  const railTeams = useMemo(() => {
    const order = session?.nomination_order || [];
    const idx = (id) => {
      const i = order.indexOf(id);
      return i === -1 ? order.length : i;
    };
    return teams
      .filter((t) => t.id !== myTeamId)
      .sort((a, b) => idx(a.id) - idx(b.id));
  }, [teams, myTeamId, session?.nomination_order]);
  const cutsActive = allowMidDraftCuts && leagueId && !draftCompleted;
  const tradesActive = Boolean(leagueId && myTeamId && !draftCompleted);

  useEffect(() => {
    if (!tradesActive || !leagueId || !myTeamId) {
      setPendingTradeCount(0);
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades?status=pending`);
        if (!res.ok) return;
        const data = await res.json();
        const mine = (data.proposals || []).filter((p) => (
          (p.parties || []).some((party) => party.team_id === myTeamId)
        ));
        if (!cancelled) setPendingTradeCount(mine.length);
      } catch {
        /* keep last count */
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tradesActive, leagueId, myTeamId, roomState?.events?.length]);

  const previewRow = useMemo(
    () => nominatePool.find((r) => r.player_id === nomPlayerId),
    [nominatePool, nomPlayerId],
  );


  const llmDigestFetchedRef = useRef(new Set());

  // Seed extractive digests from enrichment; on-demand LLM fetch for active nominee.
  useEffect(() => {
    if (!enrichment?.sentiment_by_player_id) return;
    setFantasyMediaDigests((prev) => {
      const next = { ...prev };
      for (const [pid, row] of Object.entries(enrichment.sentiment_by_player_id)) {
        const digest = pickFantasyMediaDigest(row);
        if (digest && !next[pid]) next[pid] = digest;
      }
      return next;
    });
  }, [enrichment]);

  const digestTargetId = nominee?.player_id
    || ((session?.status === "nominating" || session?.status === "picking") && nomPlayerId ? nomPlayerId : null);

  useEffect(() => {
    if (!digestTargetId || !season) return;
    const sentiment = sentimentByPlayerId[digestTargetId];
    if (!sentiment || Number(sentiment.mention_count) <= 0) return;
    if (llmDigestFetchedRef.current.has(digestTargetId)) return;

    let cancelled = false;
    setDigestLoadingId(digestTargetId);
    (async () => {
      try {
        const params = new URLSearchParams({ season: String(season) });
        if (enrichment?.week) params.set("week", String(enrichment.week));
        const name = nominee?.player_name || previewRow?.player;
        if (name) params.set("player_name", name);
        const res = await apiFetch(
          `/api/hub/draft-room/fantasy-media-digest/${digestTargetId}?${params.toString()}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.fantasy_media_digest) {
          llmDigestFetchedRef.current.add(digestTargetId);
          setFantasyMediaDigests((prev) => ({
            ...prev,
            [digestTargetId]: data.fantasy_media_digest,
          }));
        }
      } catch {
        /* keep extractive fallback */
      } finally {
        if (!cancelled) setDigestLoadingId((cur) => (cur === digestTargetId ? null : cur));
      }
    })();
    return () => { cancelled = true; };
  }, [
    digestTargetId,
    season,
    enrichment?.week,
    sentimentByPlayerId,
    nominee?.player_name,
    previewRow?.player,
  ]);

  useEffect(() => {
    if (!leagueId || !draftCompleted) {
      setDraftRecap(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/hub/league/${leagueId}/draft-recap`);
        if (cancelled) return;
        if (res.ok) {
          setDraftRecap(await res.json());
          return;
        }
        if (res.status === 404) {
          setDraftRecap({
            headline: testMode ? "Practice draft ended" : "Draft ended",
            subheadline: draftedCount > 0 ? `${draftedCount} players drafted` : "No players were drafted.",
            test_mode: testMode,
            pick_count: draftedCount,
            awards: [],
            notable_picks: [],
          });
        }
      } catch {
        if (!cancelled) setDraftRecap(null);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId, draftCompleted, testMode, draftedCount]);

  const applyState = useCallback((state) => {
    setRoomState((prev) => {
      if (!shouldApplyRoomState(prev, state, leagueId)) return prev;
      return mergeRoomState(prev, state);
    });
    setError("");
  }, [leagueId]);

  const wsRefresh = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send("refresh");
    }
  }, []);

  const clearWsReconnectTimer = useCallback(() => {
    if (wsReconnectTimerRef.current) {
      window.clearTimeout(wsReconnectTimerRef.current);
      wsReconnectTimerRef.current = null;
    }
  }, []);

  const teardownSocket = useCallback((socket) => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try { socket.close(); } catch { /* ignore */ }
  }, []);

  const connectWs = useCallback((id) => {
    if (!id) return;
    wsAliveRef.current = true;
    clearWsReconnectTimer();
    const gen = ++wsGenRef.current;
    const prev = wsRef.current;
    wsRef.current = null;
    teardownSocket(prev);
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const token = getToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    setConnectionStatus((cur) => (cur === "live" ? "reconnecting" : "connecting"));
    const ws = new WebSocket(`${proto}://${window.location.host}/api/hub/ws/${id}${qs}`);
    ws.onopen = () => {
      if (wsGenRef.current !== gen) return;
      setConnectionStatus("live");
    };
    ws.onmessage = (ev) => {
      if (wsGenRef.current !== gen) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "state") applyState(msg.payload);
      } catch { /* ignore */ }
    };
    ws.onerror = () => {
      if (wsGenRef.current === gen) setConnectionStatus("offline");
    };
    ws.onclose = () => {
      if (!shouldScheduleWsReconnect({
        roomStillMounted: wsAliveRef.current,
        closedSocketIsCurrent: wsGenRef.current === gen,
      })) {
        return;
      }
      setConnectionStatus("offline");
      wsReconnectTimerRef.current = window.setTimeout(() => {
        if (wsAliveRef.current && wsGenRef.current === gen) connectWs(id);
      }, 2000);
    };
    wsRef.current = ws;
  }, [applyState, clearWsReconnectTimer, teardownSocket]);

  const refresh = useCallback(async () => {
    if (!leagueId) return;
    const gen = ++roomFetchGenRef.current;
    setRoomLoading(true);
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}`);
      if (gen !== roomFetchGenRef.current) return;
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      applyState(await res.json());
    } catch (e) {
      if (gen !== roomFetchGenRef.current) return;
      setError(e.message || "Could not load draft room");
    } finally {
      if (gen === roomFetchGenRef.current) setRoomLoading(false);
    }
  }, [leagueId, applyState]);

  useEffect(() => {
    if (leagueId) connectWs(leagueId);
    return () => {
      wsAliveRef.current = false;
      clearWsReconnectTimer();
      const prev = wsRef.current;
      wsRef.current = null;
      teardownSocket(prev);
    };
  }, [leagueId, connectWs, clearWsReconnectTimer, teardownSocket]);

  useEffect(() => {
    if (leagueId) setWatchIds(loadWatchIds(leagueId));
  }, [leagueId]);

  const toggleWatch = useCallback((row) => {
    if (!leagueId || !row?.player_id) return;
    setWatchIds(toggleWatchId(leagueId, row.player_id));
  }, [leagueId]);

  const queuePlayer = useCallback(async (row) => {
    const pid = String(row?.player_id || "");
    if (!leagueId || !pid) return;
    const current = roomState?.viewer?.nomination_queue || [];
    if (current.map(String).includes(pid)) return;
    const res = await apiFetch(`/api/hub/league/${leagueId}/nomination-queue`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_ids: [...current, pid],
        autodraft: Boolean(roomState?.viewer?.autodraft),
      }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    applyState(await res.json());
  }, [leagueId, roomState?.viewer?.nomination_queue, roomState?.viewer?.autodraft, applyState]);

  useEffect(() => {
    if (leagueId) refresh();
  }, [leagueId, refresh]);

  // Poll during live draft (test mode bots); WS handles most updates.
  // Mock drafts always tick (bots only act on server refresh); real-league
  // rooms skip hidden tabs and catch up on return.
  useEffect(() => {
    if (!leagueId || !inLiveDraft) return undefined;
    const ms = testMode ? 5000 : 8000;
    const id = setInterval(() => {
      if (testMode || document.visibilityState === "visible") wsRefresh();
    }, ms);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") wsRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [leagueId, inLiveDraft, testMode, wsRefresh]);

  const applyBidAmount = useCallback((next) => {
    const raw = next == null ? "" : String(next);
    bidTouched.current = true;
    setBidAmount(raw);
  }, []);

  // Auto-fill next bid when high bid changes (unless user is editing)
  useEffect(() => {
    if (session?.status !== "bidding") return;
    if (!bidTouched.current && !bidFocused.current) {
      setBidAmount(String(suggestedBid));
    }
  }, [session?.status, session?.high_bid, suggestedBid]);

  // Reset manual bid edits when a new player opens for bidding.
  // Guarded by ref: suggestedBid changes on every bot bid and must not wipe
  // the user's typed amount mid-auction.
  const lastNomineeIdRef = useRef(null);
  useEffect(() => {
    const nomineeId = nominee?.player_id ?? null;
    if (nomineeId === lastNomineeIdRef.current) return;
    lastNomineeIdRef.current = nomineeId;
    bidTouched.current = false;
    if (session?.status === "bidding" && !bidFocused.current) {
      setBidAmount(String(suggestedBid));
    }
  }, [nominee?.player_id, session?.status, suggestedBid]);

  const bidInvalid = session?.status === "bidding"
    && (!bidAmount || Number(bidAmount) < suggestedBid);
  const nomineePosBlocked = nominee && !canAcquire(nominee.position);
  const selectedNomBlocked = previewRow && !canAcquire(previewRow.position);

  const minBidUnit = Number(rules?.auction?.min_bid ?? 1);
  const openSlotsTotal = useMemo(
    () => Object.values(posCapacity).reduce((sum, c) => sum + (c?.remaining || 0), 0),
    [posCapacity],
  );

  const runAction = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const startMockDraft = async (mode, { relaxSalaryRosterLimits = false } = {}) => {
    await runAction(async () => {
      const body = {
        mode,
        season: season || 2025,
        team_count: 12,
        bot_count: 7,
        auto_start: true,
      };
      if (linkedHubLeagueId || leagueId) {
        body.source_league_id = linkedHubLeagueId || leagueId;
      }
      if (mode === "keeper_sandbox") {
        body.auto_start = false;
        body.relax_salary_roster_limits = Boolean(relaxSalaryRosterLimits);
      }
      const res = await apiFetch("/api/hub/mock-draft/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMockModeLabel(
        mode === "keeper_sandbox"
          ? "Keeper sandbox"
          : mode === "league_mirror"
            ? "League mirror mock"
            : "Quick mock",
      );
      if (mode === "keeper_sandbox") {
        setSandboxSourceLeagueId(data.source_league_id || linkedHubLeagueId || leagueId || "");
      }
      onLeagueIdChange(data.league_id);
      applyState(data.state);
    });
  };

  const startKeeperSandbox = async (opts = {}) => {
    if (!(await confirmDialog({
      title: "Keeper expire sandbox",
      message: (
        "Create a practice copy of this league’s keepers and contracts?\n\n"
        + "• Real league is untouched\n"
        + "• Start / End draft here to test expirees and year tick\n"
        + "• Delete sandbox when done"
        + (opts.relaxSalaryRosterLimits
          ? "\n• Salary cap and position limits will be off (salaries can stay stale)"
          : "")
      ),
      confirmLabel: "Create sandbox",
    }))) {
      return;
    }
    await startMockDraft("keeper_sandbox", {
      relaxSalaryRosterLimits: opts.relaxSalaryRosterLimits,
    });
  };

  const deleteSandbox = async () => {
    if (!leagueId || !testMode) return;
    if (!(await confirmDialog({
      title: "Delete sandbox",
      message: "Delete this practice room and all copied keepers? Your real league is unchanged.",
      confirmLabel: "Delete sandbox",
      danger: true,
    }))) {
      return;
    }
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const backId = sandboxSourceLeagueId || linkedHubLeagueId || "";
      setSandboxSourceLeagueId("");
      setMockModeLabel("");
      setRoomState(null);
      setExpirePreview(null);
      if (toolMode) {
        onExitRoom?.();
        onLeagueIdChange("");
        return;
      }
      if (backId) {
        onLeagueIdChange(backId);
      } else {
        onLeagueIdChange("");
      }
    });
  };

  const simulateRemainingDraft = async () => {
    if (!leagueId) return;
    if (!(await confirmDialog({
      title: "Simulate full draft",
      message: pickDraft
        ? "Run the rest of this practice draft instantly? Bots pick until rosters are full."
        : "Run the rest of this practice draft instantly? Bots nominate and settle every auction until rosters are full.",
      confirmLabel: "Simulate",
    }))) {
      return;
    }
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/test/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const detail = await parseApiError(res);
        await refresh();
        throw new Error(detail);
      }
      applyState((await res.json()).state);
      setMockModeLabel("Simulated mock");
    });
  };

  const startDraft = async () => {
    const startsAt = league?.draft_starts_at;
    const scheduledFuture = startsAt && new Date(startsAt).getTime() > Date.now();
    let force = false;
    if (scheduledFuture) {
      if (!(await confirmDialog({
        title: "Start now",
        message: pickDraft
          ? "Draft night is still in the future. Start the pick draft now anyway?"
          : "Draft night is still in the future. Start the auction now anyway?",
        confirmLabel: "Start now",
      }))) {
        return;
      }
      force = true;
    }
    await runAction(async () => {
      const postStart = async ({ allowEmpty = false } = {}) => {
        const q = new URLSearchParams();
        if (force) q.set("force", "true");
        if (allowEmpty) q.set("allow_empty", "true");
        const qs = q.toString() ? `?${q}` : "";
        return apiFetch(`/api/hub/league/${leagueId}/start${qs}`, { method: "POST" });
      };
      let res = await postStart();
      if (!res.ok) {
        const detail = await parseApiError(res);
        if (/empty seat/i.test(detail)) {
          if (!(await confirmDialog({
            title: "Empty seats",
            message: `${detail}\n\nStart anyway? Unclaimed seats will not ${pickDraft ? "pick" : "bid"}.`,
            confirmLabel: "Start with empty seats",
            danger: true,
          }))) {
            throw new Error(detail);
          }
          res = await postStart({ allowEmpty: true });
          if (!res.ok) throw new Error(await parseApiError(res));
        } else {
          throw new Error(detail);
        }
      }
      roomFetchGenRef.current += 1;
      applyState(await res.json());
    });
  };

  const saveDraftSchedule = async ({ wall, timezone, clear } = {}) => {
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clear
            ? { clear_draft_start: true }
            : { draft_starts_at: wall, draft_timezone: timezone },
        ),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (data.league) {
        setRoomState((prev) => (prev ? { ...prev, league: { ...prev.league, ...data.league } } : prev));
      }
    });
  };

  const pauseOrResumeDraft = async () => {
    const paused = Boolean(session?.paused);
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/${paused ? "resume" : "pause"}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
    });
  };

  const skipNominationTurn = async () => {
    if (!(await confirmDialog({
      title: pickDraft ? "Skip pick" : "Skip nominator",
      message: pickDraft
        ? "Skip this team's pick and pass the clock to the next manager?"
        : "Skip this team's nomination and pass the clock to the next manager?",
      confirmLabel: "Skip",
    }))) {
      return;
    }
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/skip-nomination`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
    });
  };

  const endDraft = async () => {
    const label = testMode ? "practice draft" : "draft";
    if (!(await confirmDialog({
      title: `End ${label}`,
      message: `End this ${label} now? Picks so far are kept. Any player currently on the block goes back to the pool. Teams still under positional minimums will be blocked unless you override.`,
      confirmLabel: "End now",
      danger: true,
    }))) {
      return;
    }
    await runAction(async () => {
      const postEnd = async (force) => {
        const qs = force ? "?force=true" : "";
        return apiFetch(`/api/hub/league/${leagueId}/end${qs}`, { method: "POST" });
      };
      let res = await postEnd(false);
      if (!res.ok) {
        const detail = await parseApiError(res);
        if (/under positional minimums/i.test(detail)) {
          if (!(await confirmDialog({
            title: "Rosters still short",
            message: `${detail}\n\nEnd anyway? Contract years will still tick.`,
            confirmLabel: "End anyway",
            danger: true,
          }))) {
            throw new Error(detail);
          }
          res = await postEnd(true);
          if (!res.ok) throw new Error(await parseApiError(res));
        } else {
          throw new Error(detail);
        }
      }
      applyState(await res.json());
      wsRefresh();
    });
  };

  const resetPracticeDraft = async () => {
    if (!(await confirmDialog({
      title: "Reset practice draft",
      message: pickDraft
        ? "Reset this practice draft? All picks, recap, and queues will be cleared. Bots stay in the room."
        : "Reset this practice draft? All picks, bid log, recap, and budgets will be cleared. Bots stay in the room.",
      confirmLabel: "Reset draft",
      danger: true,
    }))) {
      return;
    }
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/test/reset`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      applyState(data.state);
      setPickRecap(null);
      setDraftRecap(null);
      setNomPlayerId("");
      wsRefresh();
    });
  };

  const resetLiveDraft = async () => {
    if (!(await confirmDialog({
      title: "Reset live draft",
      message: (
        "Reset this live draft back to before it started?\n\n"
        + "• Clears auction picks, bid log, and budgets\n"
        + "• Keepers stay on rosters\n"
        + "• If draft was already marked complete, years left are +1 for remaining keepers "
        + "(players who expired when you ended are not restored — re-sync if needed)"
      ),
      confirmLabel: "Reset draft",
      danger: true,
    }))) {
      return;
    }
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/reset-draft`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      applyState(data.state);
      setPickRecap(null);
      setDraftRecap(null);
      setNomPlayerId("");
      if (data.warning) setError(data.warning);
      wsRefresh();
    });
  };

  const award = async () => {
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/award`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
    });
  };

  const cutPlayer = async (playerId) => {
    if (!playerId || !leagueId) return;
    if (!(await confirmDialog({
      title: "Drop player",
      message: "Drop this player? Cap refund depends on your league cut rules.",
      confirmLabel: "Drop player",
      danger: true,
    }))) return;
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/cut`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: playerId }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
      setNominationPoolRows(null);
      wsRefresh();
    });
  };

  const playerPayload = useCallback((row) => ({
    player_id: row.player_id,
    player_name: row.player,
    team: row.team,
    position: row.position,
    // Keep fair_value as neutral baseline; risk-adjusted $ is a UI recommendation.
    fair_value: row.fair_value ?? row.model_bid_hint ?? null,
    season_proj: row.season_proj ?? null,
    per_game_proj: row.per_game_proj ?? null,
  }), []);

  const nominateRow = useCallback(async (row, { force = false } = {}) => {
    if (!row) return;
    if (force) {
      if (!(await confirmDialog({
        title: pickDraft ? "Force pick" : "Force nominate",
        message: pickDraft
          ? `Pick ${row.player || row.player_name || "this player"} for ${nominatorTeam?.name || "the on-clock team"}?`
          : (`Nominate ${row.player || row.player_name || "this player"} on behalf of `
            + `${nominatorTeam?.name || "the on-clock team"}? The opening min bid hits their budget, not yours.`),
        confirmLabel: pickDraft ? "Force pick" : "Force nominate",
        danger: true,
      }))) {
        return;
      }
    } else if (!canAcquire(row.position)) {
      setError(`Your roster is at the ${row.position} maximum — cut or trade before ${pickDraft ? "picking" : "nominating"}.`);
      return;
    }
    setNomPlayerId(row.player_id);
    setPendingAction(pickDraft ? "pick" : "nominate");
    setError("");
    try {
      const qs = force ? "?force=true" : "";
      const path = pickDraft ? "pick" : "nominate";
      const res = await apiFetch(`/api/hub/league/${leagueId}/${path}${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(playerPayload(row)),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
      setNomPlayerId("");
      bidTouched.current = false;
      wsRefresh();
    } catch (e) {
      setError(e.message || (pickDraft ? "Pick failed" : "Nomination failed"));
    } finally {
      setPendingAction("");
    }
  }, [canAcquire, leagueId, applyState, wsRefresh, playerPayload, nominatorTeam?.name, pickDraft]);

  const reviewCompletedDraft = useCallback(() => {
    if (typeof document === "undefined") return;
    const target = document.getElementById(completedReview.id);
    if (!target) return;
    if (completedReview.openDetails && target.tagName === "DETAILS") {
      target.open = true;
    }
    const reduceMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    target.focus({ preventScroll: true });
  }, [completedReview.id, completedReview.openDetails]);

  const nominate = async () => {
    const row = previewRow;
    if (!row) return;
    await nominateRow(row, { force: canForceNominate });
  };

  const bid = async (amount) => {
    const val = amount ?? Number(bidAmount);
    if (!Number.isFinite(val) || !session) return;
    if (!myTeamId) {
      setError("Join this draft room with your team to place bids.");
      return;
    }
    if (val < suggestedBid) {
      setError(`Minimum bid is ${fmtSal(suggestedBid)}`);
      return;
    }
    const prevState = roomState;
    applyState({
      ...roomState,
      session: {
        ...session,
        high_bid: val,
        high_bidder_team_id: myTeamId,
      },
    });
    setPendingAction("bid");
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: val }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
      bidTouched.current = false;
      wsRefresh();
    } catch (e) {
      if (prevState) applyState(prevState);
      setError(e.message || "Bid failed");
    } finally {
      setPendingAction("");
    }
  };

  useEffect(() => {
    const awards = (events || []).filter((e) => e.event_type === "win" || e.event_type === "pick");
    const lastAward = awards[awards.length - 1];
    if (!lastAward || lastAward.id === lastWinEventIdRef.current) return;
    lastWinEventIdRef.current = lastAward.id;
    const p = lastAward.payload || {};
    const isPick = lastAward.event_type === "pick" || pickDraft;
    const proj = p.season_proj != null && Number.isFinite(Number(p.season_proj))
      ? `${Number(p.season_proj).toFixed(0)} proj pts`
      : "";
    setPickRecap({
      player_name: p.player_name,
      position: p.position,
      team_name: p.team_name,
      amount: p.amount,
      value_grade: p.value_grade,
      value_blurb: p.value_blurb,
      detail: isPick ? (proj || p.value_blurb) : p.value_blurb,
      round: p.round,
      overall: p.overall,
      pick_draft: isPick,
    });
  }, [events, pickDraft]);

  const expireAuctionTimer = useCallback(async () => {
    if (!leagueId) return;
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}`);
      if (res.ok) applyState(await res.json());
      wsRefresh();
    } catch {
      timerExpiredRef.current = false;
    }
  }, [leagueId, applyState, wsRefresh]);

  useEffect(() => {
    if (session?.status !== "bidding" || !session?.bid_deadline) {
      timerExpiredRef.current = false;
      return undefined;
    }
    const delay = Math.max(0, new Date(session.bid_deadline).getTime() - Date.now()) + 150;
    timerExpiredRef.current = false;
    const id = setTimeout(() => {
      if (timerExpiredRef.current) return;
      timerExpiredRef.current = true;
      expireAuctionTimer();
    }, delay);
    return () => clearTimeout(id);
  }, [session?.status, session?.bid_deadline, expireAuctionTimer]);

  const activeDeadline = session?.status === "bidding"
    ? session?.bid_deadline
    : (session?.status === "nominating" || session?.status === "picking")
      ? session?.nomination_deadline
      : null;

  const activePhase = draftPhaseStep(draftStatus);

  useEffect(() => {
    if (!mobileLayout || !inLiveDraft || !onClock || !isMyNominationTurn) return;
    setMobilePanelPersist("pool");
  }, [mobileLayout, inLiveDraft, session?.status, isMyNominationTurn, setMobilePanelPersist]);

  const nominateHint = mobileLayout
    ? (pickDraft ? "Tap a player, then Pick" : "Tap a player, then Nominate")
    : (pickDraft ? "Double-click a player to pick" : "Double-click a player to nominate");

  const liveStatus = useMemo(() => {
    if (!inLiveDraft || !session) return null;
    if (session.status === "nominating" || session.status === "picking") {
      const forceLabel = pickDraft ? "Force pick" : "Force nominate";
      return {
        phase: 1,
        title: isMyNominationTurn
          ? `Your turn — ${nominateHint.toLowerCase()}`
          : canForceNominate
            ? `Waiting for ${nominatorTeam?.name || "next manager"} — ${forceLabel} available`
            : `Waiting for ${nominatorTeam?.name || "next manager"}`,
        detail: availableRows.length > 0 ? `${availableRows.length} available` : null,
      };
    }
    if (session.status === "bidding") {
      return {
        phase: 2,
        title: highBidder
          ? `High bid ${fmtSal(session.high_bid)} · ${highBidder.name}`
          : "Bidding open",
        detail: myTeamId ? `Min ${fmtSal(suggestedBid)}` : null,
      };
    }
    return null;
  }, [
    inLiveDraft,
    session,
    isMyNominationTurn,
    canForceNominate,
    nominatorTeam,
    availableRows.length,
    highBidder,
    suggestedBid,
    myTeamId,
    nominateHint,
  ]);

  const nomineeRow = useMemo(
    () => (valueRows || []).find((r) => String(r.player_id) === String(nominee?.player_id)) || null,
    [valueRows, nominee?.player_id],
  );
  const nomineeStats = useMemo(() => {
    if (!nominee) return null;
    const source = nomineeRow || {
      fair_value: nominee.fair_value,
      model_bid_hint: nominee.fair_value,
      risk_adjusted_value: nominee.risk_adjusted_value,
      risk_score: nominee.risk_score,
    };
    const fair = source.fair_value ?? source.model_bid_hint ?? null;
    const bidTo = effectiveAuctionBid(source, rules?.risk_tolerance, rules);
    const useRaav = isRiskToleranceActive(rules?.risk_tolerance)
      && bidTo != null
      && fair != null
      && Number(bidTo) !== Number(fair);
    const delta = raavDelta(source, rules?.risk_tolerance, rules);
    return {
      perGame: nominee.per_game_proj ?? nomineeRow?.per_game_proj,
      seasonProj: nominee.season_proj ?? nomineeRow?.season_proj,
      fairValue: fair,
      bidTo: bidTo ?? fair,
      bidLabel: useRaav || isRiskToleranceActive(rules?.risk_tolerance) ? "Bid to" : "Fair value",
      useRaav,
      raavDeltaLabel: formatRaavDelta(delta),
      minSal: nomineeRow?.min_sal,
      maxSal: nomineeRow?.max_sal,
      tier: nomineeRow?.tier,
    };
  }, [nominee, nomineeRow, rules]);

  const myBudget = Number(myTeam?.budget_remaining);
  const myMaxBid = Number.isFinite(myBudget)
    ? Math.max(0, relaxLimits ? myBudget : myBudget - Math.max(0, openSlotsTotal - 1) * minBidUnit)
    : null;
  const nomineePosKey = nominee
    ? (() => {
        const raw = String(nominee.position || "").toUpperCase();
        return raw === "DST" || raw === "D/ST" ? "DEF" : raw;
      })()
    : null;
  const nomineeSlotsLeft = nomineePosKey ? posCapacity[nomineePosKey]?.remaining ?? null : null;

  const bidPanel = session?.status === "bidding" ? (
    <div className={`hub-draft-actions hub-draft-actions-prominent hub-draft-actions-on-block${mobileLayout ? " hub-draft-actions--mobile" : ""}`}>
      <div className="hub-action-block">
        <form
          className={`hub-action-row${mobileLayout ? " hub-action-row--stacked" : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!(pendingAction || bidInvalid || nomineePosBlocked || session?.paused)) bid();
          }}
        >
          <input
            type="number"
            className="hub-bid-input"
            value={bidAmount}
            min={suggestedBid}
            onFocus={() => { bidFocused.current = true; }}
            onBlur={() => { bidFocused.current = false; }}
            onChange={(e) => applyBidAmount(e.target.value)}
          />
          <button type="button" className="btn-ghost btn-sm" onClick={() => applyBidAmount(suggestedBid)}>
            Min {fmtSal(suggestedBid)}
          </button>
          {[1, 5, 10].map((inc) => (
            <button
              key={inc}
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                const high = Number(session?.high_bid ?? 0) || 0;
                applyBidAmount(Math.max(suggestedBid, high + inc));
              }}
            >
              +{inc}
            </button>
          ))}
          <button
            type="submit"
            className="btn-primary"
            disabled={Boolean(pendingAction) || bidInvalid || nomineePosBlocked || Boolean(session?.paused)}
          >
            {pendingAction === "bid" ? "Bidding…" : `Bid ${fmtSal(bidAmount)}`}
          </button>
        </form>
        {myTeamId && Number.isFinite(myBudget) && (
          <p className="hub-bid-you chart-note">
            You: <strong>{fmtSal(myBudget)}</strong> left
            {myMaxBid != null && (
              <> · max bid <strong>{fmtSal(myMaxBid)}</strong></>
            )}
            {nomineeSlotsLeft != null && (
              <> · {nominee?.position} slots open: {nomineeSlotsLeft}</>
            )}
          </p>
        )}
        {bidInvalid && (
          <p className="hub-bid-hint">Minimum bid is {fmtSal(suggestedBid)}</p>
        )}
        {nomineePosBlocked && (
          <p className="hub-bid-hint">At {nominee?.position} max — can&apos;t bid.</p>
        )}
        {relaxLimits && (
          <p className="chart-note hub-sandbox-relax-banner">
            Sandbox: salary cap and position limits are off.
          </p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <HubPage className={`hub-draft-room${draftCompleted ? " hub-draft-room--ended" : ""}`}>
      {!inLiveDraft && !draftCompleted && !toolMode && (
        <header className="hub-draft-idle-header">
          <h2 className="hub-draft-idle-title">Draft room</h2>
          <p className="chart-note hub-draft-idle-lead">
            {usingHubLeague
              ? `${hubContext?.league_name || league?.name || "Your league"} — start the live draft when ready. Mock drafts live in Tools.`
              : "Set up a league to go live, or open a mock draft in Tools."}
          </p>
        </header>
      )}

      {toolMode && (
        <div className="mock-draft-room-bar">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => onExitRoom?.()}
          >
            Back to setup
          </button>
          {league?.name ? (
            <span className="chart-note">{league.name}</span>
          ) : null}
          {roomLoading && !inLiveDraft && !draftCompleted ? (
            <span className="chart-note">Loading mock draft…</span>
          ) : null}
        </div>
      )}

      {inLiveDraft && (
        <div className="hub-draft-live-strip" role="status">
          <div className="hub-draft-live-strip-main">
            <div className="hub-draft-phase-strip hub-draft-phase-strip-inline" aria-label={pickDraft ? "Draft phase" : "Auction phase"}>
              {pickDraft ? (
                <>
                  <span className={`hub-draft-phase-step${activePhase >= 1 ? " is-active" : ""}${activePhase > 1 ? " is-done" : ""}`}>Pick</span>
                  <span className={`hub-draft-phase-step${activePhase >= 3 ? " is-active" : ""}`}>Done</span>
                </>
              ) : (
                <>
                  <span className={`hub-draft-phase-step${activePhase >= 1 ? " is-active" : ""}${activePhase > 1 ? " is-done" : ""}`}>Nominate</span>
                  <span className={`hub-draft-phase-step${activePhase >= 2 ? " is-active" : ""}${activePhase > 2 ? " is-done" : ""}`}>Bid</span>
                  <span className={`hub-draft-phase-step${activePhase >= 3 ? " is-active" : ""}`}>Award</span>
                </>
              )}
            </div>
            {/* Bidding details live in the auction card — header only guides nominations. */}
            {(session?.status === "nominating" || session?.status === "picking") && liveStatus && (
              <>
                <strong className="hub-draft-live-title">{liveStatus.title}</strong>
                {pickTracker ? (
                  <span className="hub-draft-pick-tracker">{pickTracker}</span>
                ) : null}
                {activeDeadline && (
                  <DraftDeadlineClock
                    deadline={activeDeadline}
                    paused={Boolean(session?.paused)}
                    className="hub-draft-live-timer"
                  />
                )}
              </>
            )}
          </div>
          <div className="hub-draft-head-actions">
            {league && (
              <span className="chart-note hub-draft-sub hub-draft-sub-inline">
                {league.test_mode ? mockModeLabel || "Mock draft" : league.name}
              </span>
            )}
            {relaxLimits && (
              <span className="chart-note hub-sandbox-relax-banner">Limits off</span>
            )}
            {testMode && isCommissioner && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={simulateRemainingDraft}
                title="Finish the mock instantly"
              >
                Simulate
              </button>
            )}
            {isCommissioner && inLiveDraft && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={pauseOrResumeDraft}
              >
                {session?.paused ? "Resume" : "Pause"}
              </button>
            )}
            {isCommissioner && inLiveDraft && (session?.status === "nominating" || session?.status === "picking") && !session?.paused && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={skipNominationTurn}
              >
                {pickDraft ? "Skip pick" : "Skip nom"}
              </button>
            )}
            {isCommissioner && (
              <DraftOverflowMenu>
                <button type="button" role="menuitem" className="btn-ghost btn-sm hub-draft-end-btn" disabled={busy} onClick={endDraft}>
                  End draft
                </button>
                {!testMode && (
                  <button
                    type="button"
                    role="menuitem"
                    className="btn-ghost btn-sm"
                    disabled={busy}
                    onClick={resetLiveDraft}
                    title={pickDraft
                      ? "Undo draft start — clear picks, keep keepers"
                      : "Undo draft start — clear auction picks, keep keepers"}
                  >
                    Reset
                  </button>
                )}
                {testMode && (
                  <button
                    type="button"
                    role="menuitem"
                    className="btn-ghost btn-sm"
                    disabled={busy}
                    onClick={deleteSandbox}
                    title={toolMode ? "Discard this mock room" : "Delete this practice room — real league untouched"}
                  >
                    {toolMode ? "Discard mock" : "Delete sandbox"}
                  </button>
                )}
              </DraftOverflowMenu>
            )}
          </div>
        </div>
      )}

      {mobileLayout && leagueId && inLiveDraft && (
        <MobileSubnav
          className="hub-draft-mobile-tabs"
          tabs={[
            { id: "auction", label: pickDraft ? "Pick" : "Auction" },
            { id: "pool", label: "Pool" },
            { id: "teams", label: "Teams" },
            { id: "chat", label: "Chat" },
          ]}
          active={mobilePanel}
          onChange={setMobilePanelPersist}
          ariaLabel="Draft room"
        />
      )}

      {draftCompleted && (
        <div className="hub-draft-ended">
          <div className="hub-draft-ended-main" role="status">
            <strong>{testMode ? "Mock draft done" : "Draft ended"}</strong>
            <span className="chart-note hub-draft-ended-meta">
              {draftedCount} drafted
              {draftedCount === 0 && !recapHasStory ? " · no picks" : ""}
            </span>
          </div>
          <div className="hub-draft-ended-actions">
            {recapHasStory && usingHubLeague && onNavigate && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("insights")}>
                View insights
              </button>
            )}
            {hasCompletedReview && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={reviewCompletedDraft}
              >
                {completedReview.label}
              </button>
            )}
            {testMode && isCommissioner && (
              <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={resetPracticeDraft}>
                New mock
              </button>
            )}
            {testMode && isCommissioner && (
              <details className="hub-draft-ended-overflow">
                <summary className="btn-ghost btn-sm">More</summary>
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={deleteSandbox}>
                  {toolMode ? "Discard mock" : "Delete sandbox"}
                </button>
              </details>
            )}
            {!testMode && isCommissioner && (
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={resetLiveDraft}>
                Reset draft
              </button>
            )}
          </div>
        </div>
      )}

      {draftCompleted && pickDraft && recapHasStory && draftRecap && (
        <DraftRecapPanel
          recap={draftRecap}
          compact
          hideHero={false}
          viewerTeamId={myTeamId}
          mobile={mobileLayout}
          board={(
            <SnakeDraftBoard
              id={completedReview.id}
              nominationOrder={session?.nomination_order}
              teams={teams}
              events={pickEvents}
              draftType={roomState?.draft_type || rules?.draft_type}
              currentOverall={pickClock?.overall}
              viewerTeamId={myTeamId}
              rules={rules}
              mediaByPlayerId={mediaByPlayerId}
              compactDefault={false}
              variant="recap"
            />
          )}
          onViewInsights={
            usingHubLeague && onNavigate
              ? () => onNavigate("insights")
              : undefined
          }
        />
      )}

      {draftCompleted && myTeamId && leagueId && (
        <DraftOwnerReport leagueId={leagueId} />
      )}

      {draftCompleted && !pickDraft && recapHasStory && draftRecap && (
        <DraftRecapPanel
          recap={draftRecap}
          compact
          hideHero
          onViewInsights={
            usingHubLeague && onNavigate
              ? () => onNavigate("insights")
              : undefined
          }
        />
      )}

      {error && <div className="error hub-draft-error">{error}</div>}
      {inLiveDraft && (
        <DraftLiveCommandBar
          session={session}
          nominee={nominee}
          myTeamId={myTeamId}
          myBudget={myBudget}
          myMaxBid={myMaxBid}
          suggestedBid={suggestedBid}
          minBid={minBidUnit}
          bidAmount={bidAmount}
          onBidAmountChange={applyBidAmount}
          onBidAmountFocus={() => { bidFocused.current = true; }}
          onBidAmountBlur={() => { bidFocused.current = false; }}
          onBid={() => bid()}
          bidDisabled={Boolean(pendingAction) || Boolean(session?.paused)}
          pendingAction={pendingAction}
          isCommissioner={isCommissioner}
          onAward={award}
          nominatorTeam={nominatorTeam}
          nextNominatorTeam={nextClockTeam}
          isMyNominationTurn={isMyNominationTurn}
          connectionStatus={connectionStatus}
          paused={Boolean(session?.paused)}
          canNominate={onClock && (isMyNominationTurn || canForceNominate)}
          onNominate={nominate}
          nominateLabel={pickDraft ? (canForceNominate ? "Force pick" : "Pick") : `Nominate for ${fmtSal(minBidUnit || 1)}`}
          pickDraft={pickDraft}
          pickClock={pickClock}
        />
      )}


      {inLiveDraft && session?.paused && (
        <div className="hub-draft-paused-banner" role="status">
          Draft paused — clocks are frozen until the commissioner resumes.
        </div>
      )}

      <DraftPickRecap recap={pickRecap} pickDraft={pickDraft} onDismiss={() => setPickRecap(null)} />

      {showDraftEntry && (
        <DraftEntryPanel
          busy={busy}
          onStartLiveDraft={startDraft}
          onSaveSchedule={saveDraftSchedule}
          onStartKeeperSandbox={startKeeperSandbox}
          onDeleteSandbox={deleteSandbox}
          onCommissionerUpdated={applyState}
          onNavigate={onNavigate}
          hubContext={hubContext}
          league={league}
          leagueId={leagueId}
          rules={rules}
          teams={teams}
          session={session}
          poolMode={poolMode}
          usingHubLeague={usingHubLeague}
          isCommissioner={isCommissioner}
          testMode={testMode}
          inDraftSetup={inDraftSetup}
          roomLoading={roomLoading}
          mockModeLabel={mockModeLabel}
          expirePreview={expirePreview}
          emptySeats={Number(roomState?.empty_seats) || 0}
          claimedHumans={Number(roomState?.claimed_humans) || 0}
        />
      )}

      {leagueId && (inLiveDraft || draftCompleted) && (
        <div
          className={`hub-draft-layout${draftCompleted ? " hub-draft-layout--ended" : " hub-draft-layout--live-console"}${mobileLayout && !draftCompleted ? " hub-draft-layout--mobile-staged" : ""}`}
          data-mobile-panel={mobileLayout && !draftCompleted ? mobilePanel : undefined}
        >
          {!draftCompleted && (
          <div className="hub-draft-main hub-draft-mobile-section hub-draft-mobile-section--auction">
            {roomLoading && !session && (
              <p className="chart-note hub-draft-loading">Loading draft room…</p>
            )}

            {onClock && !busy && (
              <DraftOnClockPanel
                pickDraft={pickDraft}
                isMyTurn={isMyNominationTurn}
                nominatorName={nominatorTeam?.name}
                pickClock={pickClock}
                nextTeam={nextClockTeam}
                deadline={activeDeadline}
                paused={Boolean(session?.paused)}
              />
            )}

            {pickDraft && (onClock || draftCompleted === false) && (
              <SnakeDraftBoard
                nominationOrder={session?.nomination_order}
                teams={teams}
                events={pickEvents}
                draftType={roomState?.draft_type || rules?.draft_type}
                currentOverall={pickClock?.overall}
                viewerTeamId={myTeamId}
                rules={rules}
                mediaByPlayerId={mediaByPlayerId}
                compactDefault
                variant="live"
              />
            )}

            {nominee ? (
              <div className="hub-auction-card">
                <DraftNomineeCard
                  playerName={nominee.player_name}
                  position={nominee.position}
                  team={nominee.team}
                  {...playerContext(nominee.player_id)}
                  stats={nomineeStats}
                  digestLoading={digestLoadingId === nominee.player_id}
                  sentimentMeta={sentimentMeta}
                  highBid={session.high_bidder_team_id ? session.high_bid : null}
                  openingBid={rules?.auction?.min_bid}
                  highBidderName={highBidder?.name}
                  highBidderIsBot={highBidder?.is_bot}
                  deadline={session.status === "bidding" ? session.bid_deadline : null}
                />
                {bidPanel}
              </div>
            ) : (session?.status === "nominating" || session?.status === "picking") && !isMyNominationTurn ? (
              <div className="hub-nominee-card hub-nominee-empty">
                <span>
                  Waiting for {nominatorTeam?.name || "next manager"}
                  {canForceNominate ? (pickDraft ? " — you can Force pick for them" : " — you can Force nominate for them") : ""}
                </span>
              </div>
            ) : null}

            {inLiveDraft && (
              <>
                {(session?.status === "nominating" || session?.status === "picking") && previewRow && nomPlayerId && (
                  <div className="hub-nominate-confirm hub-nominate-confirm-slim">
                    <span className="hub-nominate-confirm-name">
                      {previewRow.player}
                      <span className="chart-note">
                        {" "}
                        · {previewRow.position}
                        {" · "}
                        {pickDraft
                          ? `${formatSeasonPts(previewRow.season_proj, 0)} pts`
                          : `${isRiskToleranceActive(rules?.risk_tolerance) ? "bid" : "fair"} ${fmtSal(effectiveAuctionBid(previewRow, rules?.risk_tolerance, rules)
                            ?? previewRow.fair_value)}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={
                        Boolean(pendingAction)
                        || Boolean(session?.paused)
                        || (!canForceNominate && selectedNomBlocked)
                        || !(isMyNominationTurn || canForceNominate)
                      }
                      onClick={nominate}
                    >
                      {pendingAction === "nominate" || pendingAction === "pick"
                        ? (pickDraft ? "Picking…" : "Nominating…")
                        : canForceNominate
                          ? (pickDraft ? "Force pick" : `Force nominate for ${fmtSal(minBidUnit || 1)}`)
                          : (pickDraft ? "Pick" : `Nominate for ${fmtSal(minBidUnit || 1)}`)}
                    </button>
                  </div>
                )}

                <details
                  className={`hub-draft-board-panel hub-draft-mobile-section hub-draft-mobile-section--pool${mobileLayout ? " hub-draft-board-panel--mobile" : ""}`}
                  open={mobileLayout ? mobilePanel === "pool" : boardOpen}
                  onToggle={(e) => !mobileLayout && setBoardOpen(e.currentTarget.open)}
                >
                  <summary className="hub-draft-board-summary">
                    Available players
                    <span className="chart-note"> · {availableRows.length} left · search and filter</span>
                  </summary>
                  {(mobileLayout ? mobilePanel === "pool" : boardOpen) && (
                  <div className="hub-event-panel hub-event-panel-pool hub-draft-pool-pane">
                    <div className="hub-section-head">
                      <span className="chart-note">
                        {onClock && isMyNominationTurn
                          ? (pickDraft ? "Select a player, then pick" : nominateHint)
                          : onClock && canForceNominate
                            ? (pickDraft
                              ? "Select a player, then Force pick for the on-clock team"
                              : "Select a player, then Force nominate for the on-clock team")
                            : session?.status === "bidding"
                            ? "Browse while you wait"
                            : (pickDraft ? "Waiting to pick" : "Waiting to nominate")}
                      </span>
                    </div>
                  {boardLoading ? (
                    <p className="chart-note hub-draft-loading">Loading players…</p>
                  ) : availableRows.length === 0 ? (
                    <p className="chart-note hub-draft-loading">
                      No players remain in the draft pool. Refresh to check for updated player data.
                    </p>
                  ) : (
                    <ValueSheetTable
                      compact
                      draftConsole
                      mode="all"
                      hideHeader
                      showTierFilters={false}
                      title=""
                      subtitle={`Top ${Math.min(60, availableRows.length)} shown`}
                      rows={availableRows}
                      season={season}
                      showAdd={false}
                      showDelta={false}
                      showStatus={false}
                      defaultPosFilter="ALL"
                      maxRows={60}
                      needPositions={needPositions}
                      narrativeScope="season"
                      riskTolerance={rules?.risk_tolerance ?? 0}
                      rules={rules || null}
                      selectedPlayerId={nomPlayerId}
                      onSelectPlayer={(row) => setNomPlayerId(row.player_id)}
                      onRowDoubleClick={
                        onClock && (isMyNominationTurn || canForceNominate)
                          ? (row) => nominateRow(row, { force: canForceNominate })
                          : undefined
                      }
                      onQueuePlayer={queuePlayer}
                      onWatchPlayer={toggleWatch}
                      watchIds={watchIds}
                      canNominate={onClock && (isMyNominationTurn || canForceNominate)}
                      minBid={minBidUnit || 1}
                      pickDraft={pickDraft}
                      actionLabel={pickDraft ? (canForceNominate ? "Force pick" : "Pick") : undefined}
                    />
                  )}
                  </div>
                  )}
                </details>
              </>
            )}

            <details className="hub-draft-log">
              <summary>{pickDraft ? "Pick log" : "Bid log"}</summary>
              <ul className="hub-event-log">
                {events.length === 0 && <li className="hub-event-empty">No events yet</li>}
                {[...events].reverse().slice(0, 20).map((ev) => (
                  <li key={ev.id} className={`hub-event hub-event-${ev.event_type}`}>
                    <span className="hub-event-type">{ev.event_type}</span>
                    <span>{formatDraftEvent(ev)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
          )}

          <aside className="hub-draft-sidebar hub-draft-mobile-section hub-draft-mobile-section--teams">
            {!draftCompleted && (
              <div className="hub-draft-live-rail-tabs" role="tablist" aria-label="Draft sidebar">
                {[["roster", "My roster"], ["teams", "Teams"], ["queue", "Queue"], ["chat", "Chat"]].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={railTab === id} className={`hub-draft-live-rail-tab${railTab === id ? " is-active" : ""}`} onClick={() => setRailTab(id)}>{label}</button>
                ))}
              </div>
            )}
            <div className={draftCompleted || railTab === "roster" ? "" : "hub-draft-rail-hidden"}>
            <DraftRosterPanel
              viewer={viewerPanel}
              rosterLimits={roomState?.roster_limits}
              allowMidDraftCuts={cutsActive}
              allowTrades={tradesActive}
              onCutPlayer={cutPlayer}
              onTradePlayer={(seed) => setTradeModal({ seed, view: "builder" })}
              cutBusy={busy}
              budgetRemaining={myTeam?.budget_remaining}
              maxBid={Number.isFinite(myBudget) ? myMaxBid : null}
              isNominator={String(myTeamId) === String(nominatorTeamId) && (session?.status === "nominating" || session?.status === "picking")}
              isHighBidder={myTeamId && session?.high_bidder_team_id === myTeamId}
              ended={draftCompleted}
              pendingTradeCount={pendingTradeCount}
              onOpenInbox={() => setTradeModal({ seed: null, view: "inbox" })}
              pickDraft={pickDraft}
            />
            </div>
            {inLiveDraft && myTeamId && leagueId && (
              <div className={railTab === "queue" ? "" : "hub-draft-rail-hidden"}>
              <DraftNominationQueue
                leagueId={leagueId}
                queue={roomState?.viewer?.nomination_queue || []}
                autodraft={Boolean(roomState?.viewer?.autodraft)}
                selectedPlayerId={nomPlayerId}
                selectedPlayerName={previewRow?.player || previewRow?.player_name || ""}
                playerNames={Object.fromEntries(
                  (availableRows || []).map((r) => [
                    String(r.player_id),
                    `${r.player || r.player_name || r.player_id} (${r.position || "?"})`,
                  ]),
                )}
                disabled={busy}
                pickDraft={pickDraft}
                onUpdated={applyState}
              />
              </div>
            )}
            {inLiveDraft && leagueId && (
              <div className={`hub-draft-mobile-section hub-draft-mobile-section--chat${railTab === "chat" ? "" : " hub-draft-rail-hidden"}`}>
                <LeagueChat
                  leagueId={leagueId}
                  hubContext={hubContext}
                  compact
                  lockedKind="league"
                />
              </div>
            )}
            {draftCompleted && events.length > 0 && (
              <details className="hub-draft-log hub-draft-log-sidebar">
                <summary>{pickDraft ? "Pick log" : "Bid log"}</summary>
                <ul className="hub-event-log">
                  {[...events].reverse().slice(0, 20).map((ev) => (
                    <li key={ev.id} className={`hub-event hub-event-${ev.event_type}`}>
                      <span className="hub-event-type">{ev.event_type}</span>
                      <span>{formatDraftEvent(ev)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!draftCompleted && (
            <div className={railTab === "teams" ? "" : "hub-draft-rail-hidden"}>
            <h3 className="hub-section-title hub-draft-rail-title">
              Teams <span className="chart-note">· {draftedCount} drafted</span>
            </h3>
            <div className="hub-teams-list">
              {railTeams.map((t) => (
                <DraftTeamCard
                  key={t.id}
                  team={t}
                  roster={roomState?.rosters?.[t.id] || []}
                  cap={cap}
                  isLeader={t.id === session?.high_bidder_team_id}
                  isNominator={String(t.id) === String(nominatorTeamId)}
                  isViewer={false}
                  defaultOpen={false}
                  rosterLimits={roomState?.roster_limits}
                  draftCompleted={draftCompleted}
                  pickDraft={pickDraft}
                  allowTrades={tradesActive}
                  onTradePlayer={(seed) => setTradeModal({ seed, view: "builder" })}
                />
              ))}
            </div>
            </div>
            )}
            {draftCompleted && teams.length > 0 && (
              <details
                id={!pickDraft ? completedReview.id : undefined}
                className="hub-draft-teams-collapsed"
                tabIndex={!pickDraft ? -1 : undefined}
              >
                <summary>Teams · {draftedCount} drafted</summary>
                <div className="hub-teams-list">
                  {teams.map((t) => (
                    <DraftTeamCard
                      key={t.id}
                      team={t}
                      roster={roomState?.rosters?.[t.id] || []}
                      cap={cap}
                      isLeader={false}
                      isNominator={false}
                      isViewer={t.id === myTeamId}
                      defaultOpen={t.id === myTeamId}
                      rosterLimits={roomState?.roster_limits}
                      draftCompleted={draftCompleted}
                      pickDraft={pickDraft}
                    />
                  ))}
                </div>
              </details>
            )}
          </aside>
        </div>
      )}

      {tradeModal && leagueId && myTeamId && (
        <DraftTradeModal
          leagueId={leagueId}
          myTeamId={myTeamId}
          teams={teams}
          rosters={roomState?.rosters || {}}
          seed={tradeModal.seed}
          initialView={tradeModal.view}
          onClose={() => setTradeModal(null)}
          onApplied={() => {
            setTradeModal(null);
            wsRefresh();
          }}
        />
      )}
    </HubPage>
  );
}
