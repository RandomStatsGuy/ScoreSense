import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useMobileLayout from "../useMobileLayout";
import MobileSubnav from "../layout/MobileSubnav";
import { apiFetch, getToken } from "../auth";
import { parseApiError } from "../format";
import DraftNomineeCard from "./DraftNomineeCard";
import DraftRosterPanel from "./DraftRosterPanel";
import DraftTeamCard from "./DraftTeamCard";
import DraftPickRecap from "./DraftPickRecap";
import DraftRecapPanel from "./DraftRecapPanel";
import DraftCommissionerSettings from "./DraftCommissionerSettings";
import ValueSheetTable from "./ValueSheetTable";
import DraftDeadlineClock from "./DraftDeadlineClock";
import { HubPage } from "./HubUILayout";
import { isRowAvailable } from "./valueSheetUtils";
import { buildRosterCapacity, canAcquireAtPosition, formatDraftEvent, minNextBid } from "./draftRoomHelpers";

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

const DRAFT_STATUS_LABELS = {
  setup: "Getting ready",
  nominating: "Pick a player",
  bidding: "Place bids",
  completed: "Finished",
};

function draftPhaseStep(status) {
  if (status === "bidding") return 2;
  if (status === "completed") return 3;
  if (status === "nominating") return 1;
  return 0;
}

export default function DraftRoom({
  leagueId,
  onLeagueIdChange,
  onLeagueJoined,
  valueRows,
  valueSheetLoading = false,
  hubRoster = [],
  season,
  hubContext = null,
  onNavigate,
}) {
  const [roomState, setRoomState] = useState(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [leagueName, setLeagueName] = useState("My Auction");
  const [bidAmount, setBidAmount] = useState("");
  const [nomPlayerId, setNomPlayerId] = useState("");
  const [mockModeLabel, setMockModeLabel] = useState("");
  const [botCount, setBotCount] = useState(7);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [boardOpen, setBoardOpen] = useState(true);
  const [enrichment, setEnrichment] = useState(null);
  const [beatDigests, setBeatDigests] = useState({});
  const [digestLoadingId, setDigestLoadingId] = useState(null);
  const [pickRecap, setPickRecap] = useState(null);
  const [draftRecap, setDraftRecap] = useState(null);
  const [nominationPoolRows, setNominationPoolRows] = useState(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [mobilePanel, setMobilePanel] = useState("auction");
  const mobileLayout = useMobileLayout();
  const wsRef = useRef(null);
  const bidTouched = useRef(false);
  const bidFocused = useRef(false);
  const myTeamIdRef = useRef(null);
  const lastWinEventIdRef = useRef(null);
  const timerExpiredRef = useRef(false);

  const session = roomState?.session;
  const league = roomState?.league;
  const rules = league?.rules;
  const nominee = session?.current_nominee;
  const teams = roomState?.teams || [];
  const events = roomState?.events || [];

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

  const posCapacity = useMemo(() => buildRosterCapacity(rules, myRoster), [rules, myRoster]);

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
    Object.values(roomState?.rosters || {}).forEach((rows) => {
      (rows || []).forEach((r) => { if (r.player_id) ids.add(r.player_id); });
    });
    return ids;
  }, [roomState?.rosters]);

  const hubIdSet = useMemo(
    () => new Set((hubRoster || []).map((r) => r.player_id).filter(Boolean)),
    [hubRoster],
  );

  const clientAvailableRows = useMemo(() => {
    const drafted = draftedIds;
    return (valueRows || []).filter((r) => {
      if (!r.player_id || drafted.has(r.player_id)) return false;
      if (!isRowAvailable(r)) return false;
      if (poolMode === "roster_plus_rookies") {
        return r.is_rookie || hubIdSet.has(r.player_id);
      }
      return true;
    });
  }, [valueRows, draftedIds, poolMode, hubIdSet]);

  const availableRows = useMemo(() => {
    if (nominationPoolRows != null && nominationPoolRows.length > 0) {
      return nominationPoolRows;
    }
    return clientAvailableRows;
  }, [nominationPoolRows, clientAvailableRows]);

  const boardLoading = poolLoading || (availableRows.length === 0 && valueSheetLoading);

  const draftedCount = draftedIds.size;

  const nominatePool = availableRows;

  const canAcquire = useCallback(
    (position) => canAcquireAtPosition(posCapacity, position),
    [posCapacity],
  );

  const isCommissioner = useMemo(
    () => Boolean(hubContext?.is_commissioner) || teams.some((t) => t.is_commissioner && !t.is_bot),
    [hubContext?.is_commissioner, teams],
  );

  const draftStatus = session?.status || "setup";
  const inDraftSetup = draftStatus === "setup";
  const draftCompleted = draftStatus === "completed";
  const inLiveDraft = draftStatus === "nominating" || draftStatus === "bidding";
  const recapHasStory = Boolean(
    draftRecap && ((draftRecap.awards?.length ?? 0) > 0 || (draftRecap.notable_picks?.length ?? 0) > 0),
  );
  const linkedHubLeagueId = hubContext?.league_id || "";
  const usingHubLeague = Boolean(leagueId && linkedHubLeagueId && leagueId === linkedHubLeagueId);
  const showDraftEntry = !inLiveDraft && !draftCompleted;
  const nominatorTeamId = roomState?.nominator_team_id;
  const nominatorTeam = useMemo(
    () => teams.find((t) => String(t.id) === String(nominatorTeamId)),
    [teams, nominatorTeamId],
  );
  const testMode = Boolean(league?.test_mode);
  const isMyNominationTurn = !nominatorTeamId
    || String(myTeamId) === String(nominatorTeamId)
    || (!testMode && isCommissioner);

  const sentimentByPlayerId = enrichment?.sentiment_by_player_id || {};
  const mediaByPlayerId = enrichment?.media_by_player_id || {};
  const sentimentMeta = enrichment
    ? {
        season: enrichment.season,
        week: enrichment.week,
        context_fallback: enrichment.context_fallback,
      }
    : null;

  const playerContext = useCallback(
    (playerId, row) => {
      if (!playerId) return { sentiment: null, headshotUrl: null, teamLogoUrl: null, beatDigest: null };
      const media = mediaByPlayerId[playerId] || {};
      const sentiment = sentimentByPlayerId[playerId] || null;
      return {
        sentiment,
        headshotUrl: media.headshot_url || null,
        teamLogoUrl: media.team_logo_url || null,
        beatDigest: beatDigests[playerId] || sentiment?.beat_digest || null,
      };
    },
    [mediaByPlayerId, sentimentByPlayerId, beatDigests],
  );

  useEffect(() => {
    if (!season || !valueRows?.length || testMode) return;
    const players = valueRows.slice(0, 400).map((r) => ({
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
  }, [season, valueRows, testMode]);

  useEffect(() => {
    if (session?.status === "bidding") setBoardOpen(false);
    else if (session?.status === "nominating") setBoardOpen(true);
  }, [session?.status]);

  useEffect(() => {
    if (testMode && inLiveDraft) setEnrichment(null);
  }, [testMode, inLiveDraft]);

  useEffect(() => {
    if (league && !league.test_mode) {
      setMockModeLabel("");
    }
  }, [league?.test_mode, league?.id]);

  useEffect(() => {
    if (!leagueId || testMode || mockModeLabel) {
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
  }, [leagueId, testMode, mockModeLabel, draftedCount, poolMode]);

  const allowMidDraftCuts = Boolean(rules?.auction?.allow_mid_draft_cuts);

  const myTeam = useMemo(
    () => teams.find((t) => t.id === myTeamId),
    [teams, myTeamId],
  );
  const cutsActive = allowMidDraftCuts && leagueId && !draftCompleted;

  const previewRow = useMemo(
    () => nominatePool.find((r) => r.player_id === nomPlayerId),
    [nominatePool, nomPlayerId],
  );


  const llmDigestFetchedRef = useRef(new Set());

  // Seed extractive digests from enrichment; on-demand LLM fetch for active nominee.
  useEffect(() => {
    if (!enrichment?.sentiment_by_player_id) return;
    setBeatDigests((prev) => {
      const next = { ...prev };
      for (const [pid, row] of Object.entries(enrichment.sentiment_by_player_id)) {
        if (row?.beat_digest && !next[pid]) next[pid] = row.beat_digest;
      }
      return next;
    });
  }, [enrichment]);

  const digestTargetId = nominee?.player_id
    || (session?.status === "nominating" && nomPlayerId ? nomPlayerId : null);

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
          `/api/hub/draft-room/beat-digest/${digestTargetId}?${params.toString()}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.beat_digest) {
          llmDigestFetchedRef.current.add(digestTargetId);
          setBeatDigests((prev) => ({ ...prev, [digestTargetId]: data.beat_digest }));
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
    setRoomState(state);
    setError("");
  }, []);

  const wsRefresh = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send("refresh");
    }
  }, []);

  const connectWs = useCallback((id) => {
    if (wsRef.current) wsRef.current.close();
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const token = getToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/hub/ws/${id}${qs}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "state") applyState(msg.payload);
      } catch { /* ignore */ }
    };
    wsRef.current = ws;
  }, [applyState]);

  const refresh = useCallback(async () => {
    if (!leagueId) return;
    setRoomLoading(true);
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}`);
      if (!res.ok) {
        throw new Error(await parseApiError(res));
      }
      applyState(await res.json());
    } catch (e) {
      setError(e.message || "Could not load draft room");
    } finally {
      setRoomLoading(false);
    }
  }, [leagueId, applyState]);

  useEffect(() => {
    if (leagueId) connectWs(leagueId);
    return () => wsRef.current?.close();
  }, [leagueId, connectWs]);

  useEffect(() => {
    if (leagueId) refresh();
  }, [leagueId, refresh]);

  // Poll during live draft (test mode bots); WS handles most updates
  useEffect(() => {
    if (!leagueId || !inLiveDraft) return undefined;
    const ms = testMode ? 5000 : 8000;
    const id = setInterval(() => {
      wsRefresh();
    }, ms);
    return () => clearInterval(id);
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

  // Reset manual bid edits when a new player opens for bidding
  useEffect(() => {
    bidTouched.current = false;
    if (session?.status === "bidding" && !bidFocused.current) {
      setBidAmount(String(suggestedBid));
    }
  }, [nominee?.player_id, session?.status, suggestedBid]);

  const bidInvalid = session?.status === "bidding"
    && (!bidAmount || Number(bidAmount) < suggestedBid);
  const nomineePosBlocked = nominee && !canAcquire(nominee.position);
  const selectedNomBlocked = previewRow && !canAcquire(previewRow.position);

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

  const startMockDraft = async (mode) => {
    await runAction(async () => {
      const body = {
        mode,
        season: season || 2025,
        team_count: 12,
        bot_count: Number(botCount) || 7,
        auto_start: true,
      };
      if (mode === "league_mirror") {
        body.source_league_id = linkedHubLeagueId || leagueId;
      }
      const res = await apiFetch("/api/hub/mock-draft/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMockModeLabel(mode === "league_mirror" ? "League mirror mock" : "Quick mock");
      applyState(data.state);
      onLeagueIdChange(data.league_id);
      connectWs(data.league_id);
    });
  };

  const createTestLeague = async () => startMockDraft("quick_bots");

  const startDraft = async () => {
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/start`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
    });
  };

  const endDraft = async () => {
    const label = testMode ? "practice draft" : "draft";
    if (!window.confirm(`End this ${label} now? Picks so far are kept. Any player currently on the block goes back to the pool.`)) {
      return;
    }
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/end`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
      wsRefresh();
    });
  };

  const resetPracticeDraft = async () => {
    if (!window.confirm("Reset this practice draft? All picks, bid log, recap, and budgets will be cleared. Bots stay in the room.")) {
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

  const setupTestDraft = async () => {
    await runAction(async () => {
      const res = await apiFetch(`/api/hub/league/${leagueId}/test/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_count: Number(botCount) || 3 }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState((await res.json()).state);
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
    if (!window.confirm("Drop this player? Cap refund depends on your league cut rules.")) return;
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
    fair_value: row.fair_value ?? row.model_bid_hint ?? null,
    season_proj: row.season_proj ?? null,
    per_game_proj: row.per_game_proj ?? null,
  }), []);

  const nominateRow = useCallback(async (row) => {
    if (!row) return;
    if (!canAcquire(row.position)) {
      setError(`Your roster is at the ${row.position} maximum — cut or trade before nominating.`);
      return;
    }
    setNomPlayerId(row.player_id);
    setPendingAction("nominate");
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/nominate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(playerPayload(row)),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      applyState(await res.json());
      bidTouched.current = false;
      wsRefresh();
    } catch (e) {
      setError(e.message || "Nomination failed");
    } finally {
      setPendingAction("");
    }
  }, [canAcquire, leagueId, applyState, wsRefresh, playerPayload]);

  const nominate = async () => {
    const row = previewRow;
    if (!row) return;
    await nominateRow(row);
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
    const wins = (events || []).filter((e) => e.event_type === "win");
    const lastWin = wins[wins.length - 1];
    if (!lastWin || lastWin.id === lastWinEventIdRef.current) return;
    lastWinEventIdRef.current = lastWin.id;
    const p = lastWin.payload || {};
    setPickRecap({
      player_name: p.player_name,
      position: p.position,
      team_name: p.team_name,
      amount: p.amount,
      value_grade: p.value_grade,
      value_blurb: p.value_blurb,
      detail: p.value_blurb,
    });
  }, [events]);

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
    : session?.status === "nominating"
      ? session?.nomination_deadline
      : null;

  const statusLabel = DRAFT_STATUS_LABELS[draftStatus] || draftStatus;
  const activePhase = draftPhaseStep(draftStatus);

  const liveStatus = useMemo(() => {
    if (!inLiveDraft || !session) return null;
    if (session.status === "nominating") {
      return {
        phase: 1,
        title: isMyNominationTurn
          ? "Your turn — double-click a player to nominate"
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
    nominatorTeam,
    availableRows.length,
    highBidder,
    suggestedBid,
    myTeamId,
  ]);

  const bidPanel = session?.status === "bidding" ? (
    <div className="hub-draft-actions hub-draft-actions-prominent hub-draft-actions-on-block">
      <div className="hub-action-block">
        <span className="hub-action-title">Place your bid</span>
        <div className="hub-action-row">
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
            type="button"
            className="btn-primary"
            disabled={Boolean(pendingAction) || bidInvalid || nomineePosBlocked}
            onClick={() => bid()}
          >
            {pendingAction === "bid" ? "Bidding…" : `Bid ${fmtSal(bidAmount)}`}
          </button>
          {session.high_bidder_team_id && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={award}>
              Award now {fmtSal(session.high_bid)}
            </button>
          )}
        </div>
        {bidInvalid && (
          <p className="hub-bid-hint">Minimum bid is {fmtSal(suggestedBid)}</p>
        )}
        {nomineePosBlocked && (
          <p className="hub-bid-hint">At {nominee?.position} max — can&apos;t bid.</p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <HubPage className={`hub-draft-room${draftCompleted ? " hub-draft-room--ended" : ""}`}>
      {!inLiveDraft && !draftCompleted && (
        <header className="hub-draft-idle-header">
          <h2 className="hub-draft-idle-title">Draft room</h2>
          <p className="chart-note hub-draft-idle-lead">
            {usingHubLeague
              ? `${hubContext?.league_name || league?.name || "Your league"} — mock or go live.`
              : "Mock with bots, or set up a league."}
          </p>
        </header>
      )}

      {inLiveDraft && (
        <div className="hub-draft-live-strip" role="status">
          <div className="hub-draft-live-strip-main">
            <div className="hub-draft-phase-strip hub-draft-phase-strip-inline" aria-label="Auction phase">
              <span className={`hub-draft-phase-step${activePhase >= 1 ? " is-active" : ""}${activePhase > 1 ? " is-done" : ""}`}>Nominate</span>
              <span className={`hub-draft-phase-step${activePhase >= 2 ? " is-active" : ""}${activePhase > 2 ? " is-done" : ""}`}>Bid</span>
              <span className={`hub-draft-phase-step${activePhase >= 3 ? " is-active" : ""}`}>Award</span>
            </div>
            {liveStatus && (
              <>
                <strong className="hub-draft-live-title">{liveStatus.title}</strong>
                {liveStatus.detail && <span className="chart-note">{liveStatus.detail}</span>}
                {activeDeadline && (
                  <DraftDeadlineClock deadline={activeDeadline} className="hub-draft-live-timer" />
                )}
              </>
            )}
            {testMode && (
              <span className="chart-note hub-draft-live-mock">{mockModeLabel || "Mock"}</span>
            )}
          </div>
          <div className="hub-draft-head-actions">
            {league && (
              <span className="chart-note hub-draft-sub hub-draft-sub-inline">
                {league.name}
                {league.test_mode ? " · sandbox" : ""}
              </span>
            )}
            <span className={`hub-draft-pill hub-draft-${session?.status || "setup"}`}>{statusLabel}</span>
            {isCommissioner && (
              <button type="button" className="btn-ghost btn-sm hub-draft-end-btn" disabled={busy} onClick={endDraft}>
                End
              </button>
            )}
          </div>
        </div>
      )}

      {mobileLayout && leagueId && (inLiveDraft || draftCompleted) && (
        <MobileSubnav
          className="hub-draft-mobile-tabs"
          tabs={[
            { id: "auction", label: "Auction" },
            { id: "pool", label: "Pool" },
            { id: "teams", label: "Teams" },
          ]}
          active={mobilePanel}
          onChange={setMobilePanel}
          ariaLabel="Draft room"
        />
      )}

      {draftCompleted && (
        <div className="hub-draft-ended" role="status">
          <div className="hub-draft-ended-main">
            <strong>{testMode ? "Practice done" : "Draft ended"}</strong>
            <span className="chart-note hub-draft-ended-meta">
              {draftedCount} drafted
              {draftedCount === 0 && !recapHasStory ? " · no picks" : ""}
            </span>
          </div>
          <div className="hub-draft-ended-actions">
            {recapHasStory && usingHubLeague && onNavigate && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("insights")}>
                Insights
              </button>
            )}
            {testMode && isCommissioner && (
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={resetPracticeDraft}>
                New mock
              </button>
            )}
          </div>
        </div>
      )}

      {draftCompleted && recapHasStory && draftRecap && (
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

      <DraftPickRecap recap={pickRecap} onDismiss={() => setPickRecap(null)} />

      {showDraftEntry && (
        <div className="hub-draft-entry">
          <div className="hub-draft-idle-actions">
            <div className="hub-draft-idle-mock">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || (valueSheetLoading && !valueRows?.length)}
                onClick={() => startMockDraft("quick_bots")}
              >
                {busy ? "Starting…" : "Quick mock draft"}
              </button>
              <label className="hub-draft-idle-bots">
                Bots
                <input
                  type="number"
                  min={1}
                  max={11}
                  value={botCount}
                  onChange={(e) => setBotCount(e.target.value)}
                />
              </label>
            </div>
            {valueSheetLoading && !valueRows?.length && (
              <p className="chart-note">Loading player pool…</p>
            )}
            {leagueId && inDraftSetup && !roomLoading && isCommissioner && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={startDraft}>
                Start live draft
              </button>
            )}
            {leagueId && inDraftSetup && !roomLoading && !isCommissioner && (
              <span className="chart-note hub-draft-idle-wait">Waiting for commissioner</span>
            )}
          </div>

          <details className="hub-draft-more">
            <summary>More options</summary>
            <div className="hub-draft-more-body">
              {usingHubLeague ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => startMockDraft("league_mirror")}
                >
                  Mock with {hubContext?.league_name || "your league"} managers
                </button>
              ) : (
                <p className="chart-note">
                  Join a league in{" "}
                  <button type="button" className="btn-link" onClick={() => onNavigate?.("setup")}>
                    Setup
                  </button>{" "}
                  to mock with your managers.
                </p>
              )}
              {leagueId && inDraftSetup && !roomLoading && isCommissioner && (
                <DraftCommissionerSettings
                  leagueId={leagueId}
                  rules={rules}
                  teams={teams}
                  nominationOrder={session?.nomination_order}
                  poolMode={poolMode}
                  disabled={busy}
                  onUpdated={applyState}
                />
              )}
            </div>
          </details>
        </div>
      )}

      {leagueId && (inLiveDraft || draftCompleted) && (
        <div
          className={`hub-draft-layout${draftCompleted ? " hub-draft-layout--ended" : ""}${mobileLayout ? " hub-draft-layout--mobile-staged" : ""}`}
          data-mobile-panel={mobileLayout ? mobilePanel : undefined}
        >
          {!draftCompleted && (
          <div className="hub-draft-main hub-draft-mobile-section hub-draft-mobile-section--auction">
            {roomLoading && !session && (
              <p className="chart-note hub-draft-loading">Loading draft room…</p>
            )}

            {nominee ? (
              <DraftNomineeCard
                playerName={nominee.player_name}
                position={nominee.position}
                team={nominee.team}
                {...playerContext(nominee.player_id)}
                digestLoading={digestLoadingId === nominee.player_id}
                sentimentMeta={sentimentMeta}
                highBid={session.high_bidder_team_id ? session.high_bid : null}
                openingBid={rules?.auction?.min_bid}
                highBidderName={highBidder?.name}
                highBidderIsBot={highBidder?.is_bot}
                deadline={session.status === "bidding" ? session.bid_deadline : null}
              />
            ) : session?.status === "nominating" && !isMyNominationTurn ? (
              <div className="hub-nominee-card hub-nominee-empty">
                <span>Waiting for {nominatorTeam?.name || "next manager"}</span>
              </div>
            ) : null}

            {bidPanel}

            {inLiveDraft && (
              <>
                {session?.status === "nominating" && previewRow && nomPlayerId && (
                  <div className="hub-nominate-confirm hub-nominate-confirm-slim">
                    <span className="hub-nominate-confirm-name">
                      {previewRow.player}
                      <span className="chart-note">
                        {" "}
                        · {previewRow.position} · fair {fmtSal(previewRow.fair_value)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={Boolean(pendingAction) || selectedNomBlocked || !isMyNominationTurn}
                      onClick={nominate}
                    >
                      {pendingAction === "nominate" ? "Nominating…" : "Nominate"}
                    </button>
                  </div>
                )}

                <details
                  className={`hub-draft-board-panel hub-draft-mobile-section hub-draft-mobile-section--pool${mobileLayout ? " hub-draft-board-panel--mobile" : ""}`}
                  open={mobileLayout ? mobilePanel === "pool" : boardOpen}
                  onToggle={(e) => !mobileLayout && setBoardOpen(e.currentTarget.open)}
                >
                  <summary className="hub-draft-board-summary">
                    Draft board
                    <span className="chart-note"> · {availableRows.length} left · search for more</span>
                  </summary>
                  {boardOpen && (
                  <div className="hub-event-panel hub-event-panel-pool">
                    <div className="hub-section-head">
                      <span className="chart-note">
                        {session?.status === "nominating" && isMyNominationTurn
                          ? "Double-click to nominate"
                          : session?.status === "bidding"
                            ? "Browse while you wait"
                            : "Waiting to nominate"}
                      </span>
                    </div>
                  {boardLoading ? (
                    <p className="chart-note hub-draft-loading">Loading players…</p>
                  ) : availableRows.length === 0 ? (
                    <p className="chart-note hub-draft-loading">
                      No players available. Check the Value sheet tab loads, then refresh.
                    </p>
                  ) : (
                    <ValueSheetTable
                      compact
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
                      selectedPlayerId={nomPlayerId}
                      onSelectPlayer={(row) => setNomPlayerId(row.player_id)}
                      onRowDoubleClick={
                        session?.status === "nominating" && isMyNominationTurn ? nominateRow : undefined
                      }
                    />
                  )}
                  </div>
                  )}
                </details>
              </>
            )}

            <details className="hub-draft-log">
              <summary>Bid log</summary>
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
            <DraftRosterPanel
              viewer={viewerPanel}
              rosterLimits={roomState?.roster_limits}
              allowMidDraftCuts={cutsActive}
              onCutPlayer={cutPlayer}
              cutBusy={busy}
              budgetRemaining={myTeam?.budget_remaining}
              ended={draftCompleted}
            />
            {draftCompleted && events.length > 0 && (
              <details className="hub-draft-log hub-draft-log-sidebar">
                <summary>Bid log</summary>
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
            <>
            <h3 className="hub-section-title">Teams</h3>
            <p className="chart-note hub-draft-sidebar-hint">{draftedCount} drafted</p>
            <div className="hub-teams-list">
              {teams.map((t) => (
                <DraftTeamCard
                  key={t.id}
                  team={t}
                  roster={roomState?.rosters?.[t.id] || []}
                  cap={cap}
                  isLeader={t.id === session?.high_bidder_team_id}
                  isNominator={String(t.id) === String(nominatorTeamId)}
                  isViewer={t.id === myTeamId}
                  defaultOpen={t.id === myTeamId}
                  rosterLimits={roomState?.roster_limits}
                />
              ))}
            </div>
            </>
            )}
            {draftCompleted && teams.length > 0 && (
              <details className="hub-draft-teams-collapsed">
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
                    />
                  ))}
                </div>
              </details>
            )}
          </aside>
        </div>
      )}
    </HubPage>
  );
}
