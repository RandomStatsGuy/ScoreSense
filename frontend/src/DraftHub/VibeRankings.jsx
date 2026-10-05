import "../styles/vibe-rankings.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import { usePlayerMedia } from "../PlayerCell";
import useFantasyReady from "../useFantasyReady";
import { HubExperienceHero, HubLoadingSkeleton, HubPage } from "./HubUILayout";
import { getWeeklySnapshot, setWeeklySnapshot, weeklySnapshotKey, invalidateWeeklySnapshot } from "./hubDataCache";
import { canEditHubLineup } from "./weekBoard";
import { dayStorageKey, formatPts, playersLeftToday, readAura, storageKey, todayRatedCount, vibeLineupStarters, vibeScore, vibeStarts } from "./vibeAura";
import { VIBE_COPY, deckPlayers, emptySlotCta, emptySlotName, rateHint, todayReadRows, vibeNextActions, vibeRankingRows } from "./vibeRankingsPresentation";
import VibeSwipeDeck from "./VibeSwipeDeck";
import useVibeRatings from "./useVibeRatings";

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => { const mq = window.matchMedia(query), sync = () => setMatches(mq.matches); sync(); mq.addEventListener("change", sync); return () => mq.removeEventListener("change", sync); }, [query]);
  return matches;
}

function RankingBoard({ players, auraById, votes }) {
  return <table className="hub-vibes-table"><thead><tr><th scope="col" className="num hub-vibes-rank" aria-label={VIBE_COPY.rank}>#</th><th scope="col">{VIBE_COPY.player}</th><th scope="col" className="num">{VIBE_COPY.scoreColumn}<small>{VIBE_COPY.scoreUnit}</small></th><th scope="col" className="num">{VIBE_COPY.adjustedColumn}<small>{VIBE_COPY.points}</small></th></tr></thead><tbody>{vibeRankingRows(players, auraById).map((row, i) => <tr key={row.id}><td className="num hub-vibes-rank">{i + 1}</td><td><strong>{row.name}</strong><small>{[row.position, row.team, votes[row.id] === "start" ? VIBE_COPY.start : votes[row.id] === "sit" ? VIBE_COPY.sit : null].filter(Boolean).join(" · ")}</small></td><td className="num">{row.aura}</td><td className="num"><strong>{formatPts(row.adjusted)}</strong><small>{VIBE_COPY.modelShort} {formatPts(row.model)}</small></td></tr>)}</tbody></table>;
}

export default function VibeRankings({ cacheScope, hubContext, onNavigate, reloadToken }) {
  const contextKey = `${hubContext?.mode || ""}:${hubContext?.league_id || ""}:${hubContext?.team_id || ""}`;
  const snapshotKey = weeklySnapshotKey(cacheScope, contextKey, `:${reloadToken}`);
  const dataKey = snapshotKey || `${contextKey}:${reloadToken}`;
  const [dataState, setDataState] = useState(() => ({ key: dataKey, payload: getWeeklySnapshot(snapshotKey) }));
  const data = dataState.key === dataKey ? dataState.payload : getWeeklySnapshot(snapshotKey);
  const activeKey = useRef(dataKey); activeKey.current = dataKey;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!data);
  const [busy, setBusy] = useState(false);
  const [vegasTeams, setVegasTeams] = useState({});
  const [latestById, setLatestById] = useState({});
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState("");
  const latestRequests = useRef(new Map());
  const undoRef = useRef(null);
  const wide = useMediaQuery("(min-width:769px)");
  const coarse = useMediaQuery("(pointer:coarse)");
  const load = useCallback(async (signal) => {
    const cached = getWeeklySnapshot(snapshotKey); setLoading(!cached); setError("");
    if (cached) { setDataState({ key: dataKey, payload: cached }); return; }
    try {
      const res = await apiFetch("/api/hub/week", { signal }); if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (!signal?.aborted && activeKey.current === dataKey) { setWeeklySnapshot(snapshotKey, hubContext?.league_id, payload); setDataState({ key: dataKey, payload }); }
    } catch (e) { if (!isAbortError(e) && !signal?.aborted && activeKey.current === dataKey) setError(connectionErrorMessage(e)); }
    finally { if (!signal?.aborted && activeKey.current === dataKey) setLoading(false); }
  }, [snapshotKey, dataKey, hubContext?.league_id]);
  useEffect(() => { const ctrl = new AbortController(); void load(ctrl.signal); return () => ctrl.abort(); }, [load]);
  useEffect(() => { setBusy(false); setApplyBusy(false); setLatestById({}); setVegasTeams({}); setApplyError(""); for (const controller of latestRequests.current.values()) controller.abort(); latestRequests.current.clear(); return () => { for (const controller of latestRequests.current.values()) controller.abort(); }; }, [dataKey]);
  const players = useMemo(() => deckPlayers(data), [data]);
  const season = data?.meta?.season, week = data?.meta?.week;
  const weekLabel = week != null ? `Week ${week}` : VIBE_COPY.thisWeek;
  const leagueId = data?.hub_context?.league_id || hubContext?.league_id;
  const teamId = data?.hub_context?.team_id || hubContext?.team_id;
  const key = storageKey({ cacheScope, leagueId, teamId, season, week });
  const dayKey = dayStorageKey({ cacheScope, leagueId, teamId, season, week });
  const ratings = useVibeRatings({ key, dayKey, leagueId: hubContext?.mode === "league" ? leagueId : null, season, week });
  const { auraById, dayVotes } = ratings;
  const openPlayers = useMemo(() => playersLeftToday(players, dayVotes.votes), [players, dayVotes.votes]);
  const visibleIds = useMemo(() => openPlayers.slice(0, 2).map((p) => p.player_id), [openPlayers]);
  const media = usePlayerMedia(visibleIds);
  const ratedToday = todayRatedCount(players, dayVotes.votes);
  const todayReads = todayReadRows(players, dayVotes.votes);
  const slots = useMemo(() => vibeStarts(players, auraById, hubContext?.rules), [players, auraById, hubContext?.rules]);
  useFantasyReady("vibes", "roster", Boolean(data));
  useEffect(() => {
    if (season == null || week == null) return;
    const ctrl = new AbortController();
    (async () => { try { const res = await apiFetch(`/api/lineup/vegas?season=${season}&week=${week}`, { signal: ctrl.signal }); if (res.ok) { const payload = await res.json(); if (!ctrl.signal.aborted) setVegasTeams(payload.teams || {}); } } catch { /* Detail data never blocks the player card. */ } })();
    return () => ctrl.abort();
  }, [season, week, dataKey]);
  const loadLatest = (player) => {
    if (!player?.player_id || latestById[player.player_id] || latestRequests.current.has(player.player_id)) return;
    const controller = new AbortController(), requestKey = dataKey; latestRequests.current.set(player.player_id, controller);
    const params = new URLSearchParams({ player_name: player.player_name, team: player.team || "" });
    if (season != null) params.set("season", String(season)); if (week != null) params.set("week", String(week));
    (async () => { try { const res = await apiFetch(`/api/player/${encodeURIComponent(player.player_id)}/latest?${params}`, { signal: controller.signal }); if (res.ok) { const payload = await res.json(); if (!controller.signal.aborted && activeKey.current === requestKey) setLatestById((cur) => ({ ...cur, [player.player_id]: payload })); } } catch { /* Optional notes have an honest empty state. */ } finally { if (latestRequests.current.get(player.player_id) === controller) latestRequests.current.delete(player.player_id); } })();
  };
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Backspace" && !busy && ratings.history.length && !event.target.closest?.("input,textarea,select,[contenteditable=true]")) { event.preventDefault(); ratings.undo(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [busy, ratings.undo, ratings.history.length]);
  const canEdit = canEditHubLineup({ mode: data?.hub_context?.mode || hubContext?.mode, lineupSource: data?.meta?.lineup_source, lineupLocked: data?.meta?.lineup_locked, weekScored: data?.meta?.week_scored, isCommissioner: Boolean(hubContext?.is_commissioner) });
  const actions = vibeNextActions({ canReview: ratedToday > 0 && Boolean(data) && !error, canEdit });
  const applySlate = async () => {
    if (!actions.apply || !leagueId || applyBusy) return;
    const requestKey = dataKey; setApplyBusy(true); setApplyError("");
    try { const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/lineup`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ starters: vibeLineupStarters(slots), season, week }) }); if (!res.ok) throw new Error(await parseApiError(res)); invalidateWeeklySnapshot(leagueId); if (activeKey.current === requestKey) onNavigate?.("week"); }
    catch (e) { if (activeKey.current === requestKey) setApplyError(connectionErrorMessage(e)); }
    finally { if (activeKey.current === requestKey) setApplyBusy(false); }
  };
  return <HubPage className="hub-vibes hub-experience-page" frameless>
    <div className="hub-vibes-intro"><HubExperienceHero eyebrow={VIBE_COPY.eyebrow} heading={VIBE_COPY.deckHeading} support={VIBE_COPY.deckSupport} /></div>
    <div className="hub-vibes-layout">
      <section className="hub-vibes-stage" aria-label={VIBE_COPY.rateGroup}>
        <div className="hub-vibes-progress-row"><p className="hub-vibes-progress" aria-live="polite">{data && <><strong>{openPlayers.length ? ratedToday + 1 : ratedToday}</strong> {VIBE_COPY.of} {players.length} · {weekLabel}</>}</p><button ref={undoRef} type="button" className="hub-vibes-undo" onClick={ratings.undo} disabled={!ratings.history.length || busy}>↶ {VIBE_COPY.undo}</button></div>
        {!data && !error && <div className="hub-vibes-loading" aria-busy="true"><HubLoadingSkeleton label={VIBE_COPY.loading} rows={4} /></div>}
        {error && !data && <div className="hub-vibes-message" role="alert"><p>{error}</p><button type="button" className="btn-ghost" onClick={() => load()}>{VIBE_COPY.retry}</button></div>}
        {data && !players.length && <div className="hub-vibes-message"><h2>{VIBE_COPY.emptyHeading}</h2><p>{VIBE_COPY.emptySupport}</p><button type="button" className="btn-ghost" onClick={() => onNavigate?.("roster")}>{VIBE_COPY.openTeam}</button></div>}
        {data && openPlayers.length > 0 && <VibeSwipeDeck key={key} players={openPlayers} auraById={auraById} media={media} vegasTeams={vegasTeams} latestById={latestById} onProfileOpen={loadLatest} onSwipe={ratings.rate} onBusyChange={setBusy} onDoneFocus={() => undoRef.current?.focus()} />}
        {data && players.length > 0 && !openPlayers.length && <div className="hub-vibes-message"><h2>{VIBE_COPY.doneHeading}</h2><p>{VIBE_COPY.doneSupport}</p></div>}
        {data && openPlayers.length > 0 && <p className="hub-vibes-hint">{rateHint({ coarse: coarse || !wide })}</p>}
        {todayReads.length > 0 && <details className="hub-vibes-today"><summary>{VIBE_COPY.todayReadsTitle}</summary><ul className="hub-vibes-reads">{todayReads.map((row) => <li key={row.id}><span>{row.name}</span><span>{row.vibe}</span></li>)}</ul></details>}
      </section>
      <aside className="hub-vibes-results" aria-label={VIBE_COPY.railTitle}>
        {(!data || players.length > 0) && <details className="hub-vibes-ranking" open={wide || undefined}><summary><span className="hub-vibes-ranking-head"><span><strong>{VIBE_COPY.railTitle}</strong><small>{weekLabel} · {VIBE_COPY.yourRoster}</small></span><span className="hub-disclosure-toggle hub-vibes-ranking-toggle" aria-hidden="true" /></span></summary>
          {!data ? <HubLoadingSkeleton label={VIBE_COPY.loading} rows={5} /> : <RankingBoard players={players} auraById={auraById} votes={dayVotes.votes} />}
          {actions.primary && <div className="hub-vibes-summary-actions">{actions.apply && <button type="button" className="btn-primary" disabled={applyBusy} onClick={applySlate}>{applyBusy ? VIBE_COPY.setSlateBusy : VIBE_COPY.setSlate}</button>}{actions.review && <button type="button" className={actions.primary === "review" ? "btn-primary" : "btn-ghost"} onClick={() => onNavigate?.("week")}>{VIBE_COPY.nextAction}</button>}</div>}
          {applyError && <p className="error" role="alert">{applyError}</p>}
          {Object.keys(auraById).length > 0 && <p className="hub-vibes-save-status" role="status">{VIBE_COPY.saveStatuses[ratings.status]}{ratings.status === "error" && <button className="btn-link" type="button" onClick={ratings.retry}>{VIBE_COPY.retry}</button>}</p>}
          {data && players.length > 0 && <details className="hub-vibes-lineup"><summary>{VIBE_COPY.slateTitle}</summary><p>{VIBE_COPY.slateHint}</p>{slots.map((slot) => <div className="hub-vibes-slot" key={slot.key || slot.slot}><span>{slot.slot}</span><span>{slot.player?.player_name || <button type="button" className="btn-link" onClick={() => onNavigate?.("available", { pos: slot.position })}>{onNavigate ? emptySlotCta(slot.position) : emptySlotName()}</button>}</span><strong>{slot.player ? formatPts(vibeScore(slot.player, readAura(auraById, slot.player.player_id))) : ""}</strong></div>)}</details>}
          <details className="hub-vibes-explanation"><summary>{VIBE_COPY.howItWorks}</summary><p>{VIBE_COPY.explanation}</p></details>
        </details>}
      </aside>
    </div>
  </HubPage>;
}
