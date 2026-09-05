import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import { usePlayerMedia } from "../PlayerCell";
import {
  HubExperienceHero,
  HubExperienceLayout,
  HubExperienceSummary,
  HubPage,
} from "./HubUILayout";
import VibeSwipeDeck from "./VibeSwipeDeck";
import {
  applyVibe,
  auraLeaders,
  auraTone,
  clearDayVote,
  dayStorageKey,
  formatAura,
  formatPts,
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
  vibeScore,
  vibeStarts,
} from "./vibeAura";
import {
  DEMO_VIBE_RULES,
  DEMO_VIBE_SLATE,
  VIBE_COPY,
  deckPlayers,
  emptySlotName,
  heroCopy,
} from "./vibeRankingsPresentation";

function SlateList({ title, hint, slots, auraById }) {
  return (
    <section className="hub-vibes-slate" aria-label={title}>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {(slots || []).map((slot) => {
        const player = slot.player;
        const pts = player
          ? formatPts(vibeScore(player, readAura(auraById, player.player_id)))
          : "";
        return (
          <div key={slot.key || slot.slot} className="hub-vibes-slot">
            <span className="hub-vibes-slot-pos">{slot.slot}</span>
            <span className="hub-vibes-slot-name">
              {player?.player_name || emptySlotName(slot.position)}
            </span>
            <span className="hub-vibes-slot-pts">{pts}</span>
          </div>
        );
      })}
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

  useEffect(() => {
    setAuraById(loadAura(key));
    setDayVotes(loadDayVotes(dayKey));
    setHistory([]);
  }, [dayKey, key]);

  useEffect(() => {
    saveAura(key, auraById);
  }, [auraById, key]);

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
  const leaders = useMemo(() => auraLeaders(ratedPlayers, auraById, 1), [auraById, ratedPlayers]);
  const ratedToday = todayRatedCount(players, dayVotes.votes);
  const done = rosterReady && players.length > 0 && openPlayers.length === 0;
  const empty = rosterReady && !usingDemo && rosterPlayers.length === 0;
  const hero = heroCopy({ demo: usingDemo && !loading, empty, done });
  const current = openPlayers[0];

  const commit = (vibe, player) => {
    if (!player?.player_id) return;
    setAuraById((cur) => applyVibe(cur, player.player_id, vibe));
    setDayVotes((cur) => recordDayVote(cur, player.player_id, vibe));
    setHistory((cur) => [...cur, { playerId: player.player_id, vibe }]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    const reverse = last.vibe === "start" ? "sit" : "start";
    setAuraById((cur) => applyVibe(cur, last.playerId, reverse));
    setDayVotes((cur) => clearDayVote(cur, last.playerId));
    setHistory((cur) => cur.slice(0, -1));
  };

  const hottest = leaders[0];
  const railItems = [
    {
      id: "hot",
      label: VIBE_COPY.hottest,
      value: hottest ? `${hottest.player.player_name} · ${formatAura(hottest.aura)}` : "—",
      tone: hottest && auraTone(hottest.aura) === "cold" ? "warn" : undefined,
    },
    { id: "rated", label: VIBE_COPY.rated, value: `${ratedToday}/${players.length}` },
  ];

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
            action={!usingDemo ? (
              <button
                type="button"
                className="btn-primary hub-experience-summary-action"
                onClick={() => onNavigate?.("week")}
                disabled={!done && ratedToday === 0}
                title={!done && ratedToday === 0 ? VIBE_COPY.nextActionDisabled : undefined}
              >
                {VIBE_COPY.nextAction}
              </button>
            ) : null}
          />
        )}
      >
        {error ? <div className="error">{error}</div> : null}
        {loading && !data ? <p className="hub-vibes-empty">{VIBE_COPY.loading}</p> : null}

        {!done ? (
          <div className="hub-vibes-stage">
            <p className="hub-vibes-hint">{VIBE_COPY.swipeHint}</p>
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
            />
            <div className="hub-vibes-actions">
              <button type="button" className="hub-vibes-vote hub-vibes-vote--sit" onClick={() => current && commit("sit", current)}>
                {VIBE_COPY.sit}
              </button>
              <button type="button" className="btn-ghost" onClick={undo} disabled={!history.length}>
                {VIBE_COPY.undo}
              </button>
              <button type="button" className="hub-vibes-vote hub-vibes-vote--start" onClick={() => current && commit("start", current)}>
                {VIBE_COPY.start}
              </button>
            </div>
            <p className="hub-vibes-progress">{VIBE_COPY.deckProgress(ratedToday, players.length)}</p>
            <p className="hub-vibes-keys">{VIBE_COPY.keyboardHint}</p>
          </div>
        ) : (
          <div className="hub-vibes-results">
            <p className="hub-vibes-hint">{VIBE_COPY.lockedToday}</p>
            <div className="hub-vibes-actions">
              {!usingDemo ? (
              <button type="button" className="btn-primary" onClick={() => onNavigate?.("week")}>
                {VIBE_COPY.resultsCta}
              </button>
              ) : null}
            </div>
          </div>
        )}

        <SlateList
          title={VIBE_COPY.slateTitle}
          hint={VIBE_COPY.slateHint}
          slots={vibeSlots}
          auraById={auraById}
        />

        <section className="hub-vibes-splits" aria-label={VIBE_COPY.vsModel}>
          <h3>{VIBE_COPY.vsModel}</h3>
          {splits.pairs.length === 0 ? (
            <p>{VIBE_COPY.vsModelEmpty}</p>
          ) : splits.pairs.map((pair) => (
            <div key={`${pair.start.player_id}-${pair.sit.player_id}`} className="hub-vibes-compare">
              <div>
                <span>{VIBE_COPY.vsYours}</span>
                <strong>{pair.start.player_name}</strong>
              </div>
              <div>
                <span>{VIBE_COPY.vsBoard}</span>
                <strong>{pair.sit.player_name}</strong>
              </div>
            </div>
          ))}
        </section>
      </HubExperienceLayout>
    </HubPage>
  );
}
