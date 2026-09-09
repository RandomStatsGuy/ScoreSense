import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import { usePlayerMedia } from "../PlayerCell";
import {
  HubExperienceHero,
  HubExperienceLayout,
  HubExperienceSummary,
  HubLoadingSkeleton,
  HubPage,
} from "./HubUILayout";
import { canEditHubLineup } from "./weekBoard";
import {
  applyVibe,
  auraLeaders,
  clearDayVote,
  dayStorageKey,
  formatPts,
  formatPtsDelta,
  loadAura,
  loadDayVotes,
  playersLeftToday,
  projectionStarts,
  readAura,
  recordDayVote,
  saveAura,
  saveDayVotes,
  storageKey,
  todayRatedCount,
  vibeDivergences,
  vibeLineupStarters,
  vibeScore,
  vibeStarts,
} from "./vibeAura";
import {
  DEMO_VIBE_RULES,
  DEMO_VIBE_SLATE,
  VIBE_COPY,
  deckPlayers,
  emptySlotCta,
  emptySlotName,
  heroCopy,
  hottestLabel,
  rateHint,
  todayReadRows,
  vibeNextActions,
  vsModelNote,
  vsSplitRows,
} from "./vibeRankingsPresentation";

const VibeSwipeDeck = lazy(() => import("./VibeSwipeDeck"));

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(Boolean(mq.matches));
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return coarse;
}

function SlateList({ title, hint, slots, auraById, onNavigate }) {
  return (
    <section className="hub-vibes-slate" aria-label={title}>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {(slots || []).map((slot) => {
        const player = slot.player;
        const pos = slot.position || String(slot.slot || "").replace(/\d+$/, "");
        const pts = player
          ? formatPts(vibeScore(player, readAura(auraById, player.player_id)))
          : "";
        return (
          <div key={slot.key || slot.slot} className="hub-vibes-slot">
            <span className="hub-vibes-slot-pos">{slot.slot}</span>
            <span className="hub-vibes-slot-name">
              {player?.player_name
                || (onNavigate ? (
                  <button
                    type="button"
                    className="btn-link hub-vibes-slot-cta"
                    onClick={() => onNavigate("available", { pos })}
                  >
                    {emptySlotCta(pos)}
                  </button>
                ) : emptySlotName())}
            </span>
            {player ? <span className="hub-vibes-slot-pts">{pts}</span> : null}
          </div>
        );
      })}
    </section>
  );
}

function VsBoardTable({ pairs, auraById, ratedToday }) {
  const rows = vsSplitRows(pairs, auraById);
  const note = vsModelNote({
    ratedToday,
    pairCount: rows.length,
    hasStoredAura: Object.keys(auraById || {}).length > 0,
  });
  return (
    <section className="hub-vibes-splits" aria-label={VIBE_COPY.vsModel}>
      <h3>{VIBE_COPY.vsModel}</h3>
      <p>{note}</p>
      {rows.length > 0 ? (
        <table className="hub-vibes-vs-table">
          <thead>
            <tr>
              <th scope="col">{VIBE_COPY.vsYours}</th>
              <th scope="col">{VIBE_COPY.vsBoard}</th>
              <th scope="col">{VIBE_COPY.vsDelta}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <strong>{row.yoursName}</strong>
                  <span>{formatPts(row.yoursPts)}</span>
                </td>
                <td>
                  <strong>{row.boardName}</strong>
                  <span>{formatPts(row.boardPts)}</span>
                </td>
                <td>{formatPtsDelta(row.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

export default function VibeRankings({
  hubContext,
  onNavigate,
  reloadToken,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [auraById, setAuraById] = useState({});
  const [dayVotes, setDayVotes] = useState(() => loadDayVotes(""));
  const [vegasTeams, setVegasTeams] = useState({});
  const [latestById, setLatestById] = useState({});
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState("");
  const coarsePointer = useCoarsePointer();

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/hub/week", { signal });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (!signal?.aborted) setData(payload);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      setError(connectionErrorMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, hubContext?.league_id, hubContext?.team_id, hubContext?.mode, reloadToken]);

  const rosterPlayers = useMemo(() => deckPlayers(data), [data]);
  const rosterReady = Boolean(data) || (!loading && !error);
  const usingDemo = rosterReady && rosterPlayers.length === 0;
  const players = usingDemo ? DEMO_VIBE_SLATE : rosterPlayers;
  const playerIds = useMemo(() => players.map((row) => row.player_id), [players]);
  const media = usePlayerMedia(usingDemo ? [] : playerIds);

  const season = data?.meta?.season;
  const week = data?.meta?.week;
  const weekLabel = week != null ? `Week ${week}` : "This week";

  useEffect(() => {
    if (usingDemo || season == null || week == null) {
      setVegasTeams({});
      return undefined;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(`/api/lineup/vegas?season=${season}&week=${week}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const board = await res.json();
        if (!ctrl.signal.aborted) setVegasTeams(board.teams || {});
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) return;
        setVegasTeams({});
      }
    })();
    return () => ctrl.abort();
  }, [season, usingDemo, week]);

  const loadLatest = (player) => {
    if (usingDemo || !player?.player_id || latestById[player.player_id]) return;
    const params = new URLSearchParams();
    if (season != null) params.set("season", String(season));
    if (week != null) params.set("week", String(week));
    if (player.player_name) params.set("player_name", player.player_name);
    if (player.team) params.set("team", player.team);
    const q = params.toString() ? `?${params.toString()}` : "";
    (async () => {
      try {
        const res = await apiFetch(`/api/player/${encodeURIComponent(player.player_id)}/latest${q}`);
        if (!res.ok) return;
        const payload = await res.json();
        setLatestById((cur) => ({ ...cur, [player.player_id]: payload }));
      } catch {
        /* latest is optional */
      }
    })();
  };
  const key = storageKey({
    leagueId: data?.hub_context?.league_id || hubContext?.league_id,
    season: data?.meta?.season,
    week: data?.meta?.week,
  });
  const dayKey = dayStorageKey({
    leagueId: data?.hub_context?.league_id || hubContext?.league_id,
    season: data?.meta?.season,
    week: data?.meta?.week,
  });

  const leagueId = data?.hub_context?.league_id || hubContext?.league_id;

  const persistRemote = useCallback((next) => {
    if (!leagueId || season == null || week == null) return;
    apiFetch("/api/hub/vibes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aura_by_id: next, week, season }),
    }).catch(() => {});
  }, [leagueId, season, week]);

  useEffect(() => {
    setAuraById(loadAura(key));
    setDayVotes(loadDayVotes(dayKey));
    setHistory([]);
    setApplyError("");
  }, [dayKey, key]);

  useEffect(() => {
    saveAura(key, auraById);
  }, [auraById, key]);

  useEffect(() => {
    if (!leagueId || season == null || week == null) return undefined;
    const ctrl = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams({
          week: String(week),
          season: String(season),
        });
        const res = await apiFetch(`/api/hub/vibes?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const payload = await res.json();
        const remote = payload?.aura_by_id;
        if (remote && typeof remote === "object" && Object.keys(remote).length) {
          setAuraById(remote);
          saveAura(key, remote);
          return;
        }
        const local = loadAura(key);
        if (Object.keys(local).length) persistRemote(local);
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) return;
      }
    })();
    return () => ctrl.abort();
  }, [key, leagueId, persistRemote, season, week]);

  useEffect(() => {
    saveDayVotes(dayKey, dayVotes);
  }, [dayKey, dayVotes]);

  const rules = usingDemo ? DEMO_VIBE_RULES : hubContext?.rules;
  const projSlots = useMemo(() => projectionStarts(players, rules), [players, rules]);
  const vibeSlots = useMemo(() => vibeStarts(players, auraById, rules), [auraById, players, rules]);
  const splits = useMemo(() => vibeDivergences(projSlots, vibeSlots), [projSlots, vibeSlots]);
  const openPlayers = useMemo(
    () => playersLeftToday(players, dayVotes.votes),
    [dayVotes.votes, players],
  );
  const ratedPlayers = useMemo(
    () => players.filter((player) => Object.prototype.hasOwnProperty.call(auraById, player.player_id)),
    [auraById, players],
  );
  const leaders = useMemo(() => auraLeaders(ratedPlayers, auraById, 2), [auraById, ratedPlayers]);
  const ratedToday = todayRatedCount(players, dayVotes.votes);
  const done = rosterReady && players.length > 0 && openPlayers.length === 0;
  const empty = rosterReady && !usingDemo && rosterPlayers.length === 0;
  const hero = heroCopy({ demo: usingDemo && !loading, empty, done });
  const current = openPlayers[0];
  const hint = rateHint({ coarse: coarsePointer });

  const commit = (vibe, player) => {
    if (!player?.player_id) return;
    setAuraById((cur) => {
      const next = applyVibe(cur, player.player_id, vibe);
      persistRemote(next);
      return next;
    });
    setDayVotes((cur) => recordDayVote(cur, player.player_id, vibe));
    setHistory((cur) => [...cur, { playerId: player.player_id, vibe }]);
  };

  const undo = useCallback(() => {
    setHistory((cur) => {
      const last = cur[cur.length - 1];
      if (!last) return cur;
      const reverse = last.vibe === "start" ? "sit" : "start";
      setAuraById((aura) => {
        const next = applyVibe(aura, last.playerId, reverse);
        persistRemote(next);
        return next;
      });
      setDayVotes((votes) => clearDayVote(votes, last.playerId));
      return cur.slice(0, -1);
    });
  }, [persistRemote]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Backspace") return;
      const tag = event.target?.tagName;
      if (tag && /input|textarea|select/i.test(tag)) return;
      if (!history.length) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.length, undo]);

  const railItems = [
    {
      id: "hot",
      label: VIBE_COPY.hottest,
      value: hottestLabel(leaders),
    },
  ];
  const canReview = !usingDemo && ratedToday > 0;
  const canEdit = canEditHubLineup({
    mode: data?.hub_context?.mode || hubContext?.mode,
    lineupSource: data?.meta?.lineup_source,
    lineupLocked: data?.meta?.lineup_locked,
  });
  const nextActions = vibeNextActions({ canReview, canEdit });
  const todayReads = todayReadRows(players, dayVotes?.votes);

  const applySlate = async () => {
    if (!leagueId || !nextActions.apply) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/lineup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starters: vibeLineupStarters(vibeSlots),
          week,
          season,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onNavigate?.("week");
    } catch (e) {
      setApplyError(connectionErrorMessage(e) || VIBE_COPY.setSlateError);
    } finally {
      setApplyBusy(false);
    }
  };

  const reviewButton = nextActions.review ? (
    <button
      type="button"
      className={nextActions.primary === "review" ? "btn-primary" : "btn-ghost"}
      onClick={() => onNavigate?.("week")}
    >
      {VIBE_COPY.nextAction}
    </button>
  ) : null;
  const applyButton = nextActions.apply ? (
    <button
      type="button"
      className="btn-primary"
      onClick={applySlate}
      disabled={applyBusy}
    >
      {applyBusy ? VIBE_COPY.setSlateBusy : VIBE_COPY.setSlate}
    </button>
  ) : null;
  const summaryAction = nextActions.primary ? (
    <div className="hub-experience-summary-action hub-vibes-summary-actions">
      {applyButton}
      {reviewButton}
    </div>
  ) : null;

  return (
    <HubPage className="hub-vibes hub-experience-page">
      <HubExperienceHero
        eyebrow={VIBE_COPY.eyebrow}
        heading={hero.heading}
        support={hero.support}
        chip={hero.chip}
        chipTone={hero.chipTone}
      />

      <HubExperienceLayout
        summaryLabel={VIBE_COPY.railTitle}
        summary={(
          <HubExperienceSummary
            eyebrow=""
            title={VIBE_COPY.railTitle}
            subtitle={VIBE_COPY.railSubtitle(weekLabel)}
            items={railItems}
            action={summaryAction}
            status={applyError ? <p className="error">{applyError}</p> : null}
          >
            <SlateList
              title={VIBE_COPY.slateTitle}
              hint={VIBE_COPY.slateHint}
              slots={vibeSlots}
              auraById={auraById}
              onNavigate={usingDemo ? null : onNavigate}
            />
            <VsBoardTable
              pairs={splits.pairs}
              auraById={auraById}
              ratedToday={ratedToday}
            />
          </HubExperienceSummary>
        )}
      >
        {error ? <div className="error">{error}</div> : null}
        {loading && !data ? <HubLoadingSkeleton label={VIBE_COPY.loading} rows={3} /> : null}

        {!done ? (
          <div className="hub-vibes-stage">
            <Suspense fallback={<HubLoadingSkeleton label={VIBE_COPY.loading} rows={2} />}>
              <VibeSwipeDeck
                players={openPlayers}
                index={0}
                auraById={auraById}
                media={media}
                vegasTeams={vegasTeams}
                latestById={latestById}
                onProfileOpen={loadLatest}
                onSwipe={commit}
                disabled={loading && !openPlayers.length}
                coarsePointer={coarsePointer}
              />
            </Suspense>
            <p className="hub-vibes-progress" aria-live="polite">
              {VIBE_COPY.deckProgress(ratedToday, players.length)}
            </p>
            <p className="hub-vibes-hint">{hint}</p>
            <div className="hub-vibes-actions">
              <div className="hub-vibes-votes" role="group" aria-label={VIBE_COPY.rateGroup}>
                <button
                  type="button"
                  className="hub-vibes-vote hub-vibes-vote--sit"
                  onClick={() => current && commit("sit", current)}
                >
                  {VIBE_COPY.sit}
                </button>
                <button
                  type="button"
                  className="hub-vibes-vote hub-vibes-vote--start"
                  onClick={() => current && commit("start", current)}
                >
                  {VIBE_COPY.start}
                </button>
              </div>
              <button
                type="button"
                className="hub-vibes-undo"
                onClick={undo}
                disabled={!history.length}
                title={!history.length ? VIBE_COPY.undoDisabled : undefined}
              >
                {VIBE_COPY.undo}
              </button>
            </div>
          </div>
        ) : (
          todayReads.length ? (
          <div className="hub-vibes-results">
            <h2 className="hub-vibes-reads-title">{VIBE_COPY.todayReadsTitle}</h2>
            <ul className="hub-vibes-reads">
              {todayReads.map((row) => (
                <li key={row.id}>
                  <span>{row.name}</span>
                  <span>{row.vibe}</span>
                </li>
              ))}
            </ul>
          </div>
          ) : null
        )}
      </HubExperienceLayout>
    </HubPage>
  );
}
