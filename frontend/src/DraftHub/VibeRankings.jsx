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
  formatAura,
  formatPts,
  loadAura,
  projectionStarts,
  ratedCount,
  saveAura,
  storageKey,
  vibeDivergences,
  vibeStarts,
} from "./vibeAura";
import {
  DEMO_VIBE_RULES,
  DEMO_VIBE_SLATE,
  VIBE_COPY,
  deckPlayers,
  heroCopy,
} from "./vibeRankingsPresentation";

function SlateList({ title, hint, slots }) {
  return (
    <section className="hub-vibes-slate" aria-label={title}>
      <h3>{title}</h3>
      {hint ? <p>{hint}</p> : null}
      {(slots || []).map((slot) => {
        const player = slot.player;
        return (
          <div key={slot.key || slot.slot} className="hub-vibes-slot">
            <span className="hub-vibes-slot-pos">{slot.slot}</span>
            <span className="hub-vibes-slot-name">{player?.player_name || "—"}</span>
            <span className="hub-vibes-slot-pts">{player ? formatPts(player.p50) : ""}</span>
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
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([]);
  const [auraById, setAuraById] = useState({});

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

  const weekLabel = data?.meta?.week != null ? `Week ${data.meta.week}` : "This week";
  const key = storageKey({
    leagueId: data?.hub_context?.league_id || hubContext?.league_id,
    season: data?.meta?.season,
    week: data?.meta?.week,
  });

  useEffect(() => {
    setAuraById(loadAura(key));
    setIndex(0);
    setHistory([]);
  }, [key]);

  useEffect(() => {
    saveAura(key, auraById);
  }, [auraById, key]);

  const rules = usingDemo ? DEMO_VIBE_RULES : hubContext?.rules;
  const projSlots = useMemo(() => projectionStarts(players, rules), [players, rules]);
  const vibeSlots = useMemo(() => vibeStarts(players, auraById, rules), [auraById, players, rules]);
  const splits = useMemo(() => vibeDivergences(projSlots, vibeSlots), [projSlots, vibeSlots]);
  const leaders = useMemo(() => auraLeaders(players, auraById, 3), [auraById, players]);
  const rated = ratedCount(players, auraById);
  const done = rosterReady && players.length > 0 && index >= players.length;
  const empty = rosterReady && !usingDemo && rosterPlayers.length === 0;
  const hero = heroCopy({ demo: usingDemo && !loading, empty, done });

  const commit = (vibe, player) => {
    setAuraById((cur) => applyVibe(cur, player.player_id, vibe));
    setHistory((cur) => [...cur, { playerId: player.player_id, vibe, index }]);
    setIndex((cur) => cur + 1);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    const reverse = last.vibe === "start" ? "sit" : "start";
    setAuraById((cur) => applyVibe(cur, last.playerId, reverse));
    setHistory((cur) => cur.slice(0, -1));
    setIndex(last.index);
  };

  const reshuffle = () => {
    setIndex(0);
    setHistory([]);
  };

  const clearAura = () => {
    setAuraById({});
    setHistory([]);
    setIndex(0);
  };

  const hottest = leaders[0];
  const railItems = [
    { id: "left", label: VIBE_COPY.cardsLeft, value: String(Math.max(0, players.length - index)) },
    { id: "rated", label: VIBE_COPY.rated, value: `${rated}/${players.length}` },
    {
      id: "hot",
      label: VIBE_COPY.hottest,
      value: hottest ? `${hottest.player.player_name} · ${formatAura(hottest.aura)}` : "—",
      tone: hottest && auraTone(hottest.aura) === "cold" ? "warn" : undefined,
    },
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
            title={VIBE_COPY.railTitle}
            subtitle={VIBE_COPY.railSubtitle(weekLabel)}
            items={railItems}
            note={usingDemo && !loading ? VIBE_COPY.demoNote : undefined}
            action={(
              <button
                type="button"
                className="btn-primary hub-experience-summary-action"
                onClick={() => onNavigate?.("week")}
                disabled={!done && rated === 0}
                title={!done && rated === 0 ? VIBE_COPY.nextActionDisabled : undefined}
              >
                {VIBE_COPY.nextAction}
              </button>
            )}
          />
        )}
      >
        {error ? <div className="error">{error}</div> : null}
        {loading && !data ? <p className="hub-vibes-empty">{VIBE_COPY.loading}</p> : null}

        {!done ? (
          <div className="hub-vibes-stage">
            <VibeSwipeDeck
              players={players}
              index={index}
              auraById={auraById}
              media={media}
              onSwipe={commit}
              disabled={loading && !players.length}
            />
            <div className="hub-vibes-actions">
              <button type="button" className="hub-vibes-vote hub-vibes-vote--sit" onClick={() => players[index] && commit("sit", players[index])}>
                {VIBE_COPY.sit}
              </button>
              <button type="button" className="btn-ghost" onClick={undo} disabled={!history.length}>
                {VIBE_COPY.undo}
              </button>
              <button type="button" className="hub-vibes-vote hub-vibes-vote--start" onClick={() => players[index] && commit("start", players[index])}>
                {VIBE_COPY.start}
              </button>
            </div>
            <p className="hub-vibes-progress">{VIBE_COPY.deckProgress(index, players.length)}</p>
            <p className="hub-vibes-hint">{VIBE_COPY.swipeHint}</p>
            <p className="hub-vibes-keys">{VIBE_COPY.keyboardHint}</p>
          </div>
        ) : (
          <div className="hub-vibes-results">
            <div className="hub-vibes-actions">
              <button type="button" className="btn-ghost" onClick={reshuffle}>{VIBE_COPY.resultsAgain}</button>
              <button type="button" className="btn-ghost" onClick={clearAura}>{VIBE_COPY.clearAura}</button>
              <button type="button" className="btn-primary" onClick={() => onNavigate?.("week")}>
                {VIBE_COPY.resultsCta}
              </button>
            </div>
          </div>
        )}

        <SlateList title={VIBE_COPY.slateTitle} hint={VIBE_COPY.slateHint} slots={vibeSlots} />

        <section className="hub-vibes-splits" aria-label={VIBE_COPY.vsModel}>
          <h3>{VIBE_COPY.vsModel}</h3>
          {splits.pairs.length === 0 ? (
            <p>{VIBE_COPY.vsModelEmpty}</p>
          ) : splits.pairs.map((pair) => (
            <div key={`${pair.start.player_id}-${pair.sit.player_id}`} className="hub-vibes-split">
              <span className="hub-vibes-split-name">{pair.start.player_name}</span>
              <span className="hub-vibes-split-over">over</span>
              <span className="hub-vibes-split-name">{pair.sit.player_name}</span>
            </div>
          ))}
        </section>

        <section className="hub-vibes-leaders" aria-label={VIBE_COPY.hottest}>
          <h3>{VIBE_COPY.hottest}</h3>
          {leaders.map(({ player, aura }) => (
            <div key={player.player_id} className="hub-vibes-leader">
              <span className={`hub-vibes-leader-aura hub-vibes-stat--${auraTone(aura)}`}>{formatAura(aura)}</span>
              <span className="hub-vibes-leader-name">{player.player_name}</span>
              <span className="hub-vibes-leader-pts">{VIBE_COPY.auraLabel}</span>
            </div>
          ))}
        </section>
      </HubExperienceLayout>
    </HubPage>
  );
}
