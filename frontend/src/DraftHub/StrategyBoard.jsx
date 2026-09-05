import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { usePlayerMedia } from "../PlayerCell";
import { formatSeasonPts } from "../seasonQuantiles";
import {
  HubAlert,
  HubAlertStack,
  HubFilterChip,
  HubFilterScroll,
  HubPage,
} from "./HubUILayout";
import { fmtSal } from "./rosterFormat";
import {
  applyOrder,
  applyPick,
  boardContext,
  buildSiteBoard,
  contextFingerprint,
  DEFAULT_SCORING_PROFILE,
  draftTypeFromRules,
  formatRankMove,
  loadRankState,
  mergeOrder,
  nextPair,
  pairKey,
  playerName,
  queueFromOrder,
  rankDelta,
  saveRankState,
  suggestedBid,
} from "./strategyRank.js";
import {
  STRATEGY_RANK_COPY as COPY,
  contextLine,
  takeLabel,
} from "./strategyRankPresentation.js";
import { headshotCandidates, lookupPlayerMedia, playerInitials, teamLogoUrl } from "./draftMedia";
import { nflTeamColors } from "./nflTeamColors";
import { suggestedBidSubLabel } from "./suggestedBidLabel.js";

const POS_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

function StrategyPhoto({ row, media, className = "", hero = false }) {
  const [shotIndex, setShotIndex] = useState(0);
  const mediaRow = lookupPlayerMedia(media, row?.player_id);
  const shots = headshotCandidates(mediaRow);
  const headshot = shots[shotIndex] || null;
  const logo = mediaRow?.team_logo_url || teamLogoUrl(row?.team);
  const name = playerName(row);
  const colors = nflTeamColors(row?.team);

  useEffect(() => {
    setShotIndex(0);
  }, [row?.player_id, mediaRow?.headshot_url, mediaRow?.espn_headshot_url]);

  return (
    <div
      className={`hub-strategy-photo${hero ? " hub-strategy-photo--hero" : ""} ${className}`.trim()}
      style={hero ? {
        "--strategy-team-top": colors.jersey[0],
        "--strategy-team-bot": colors.jersey[1],
      } : undefined}
      aria-hidden
    >
      {hero && logo ? (
        <img className="hub-strategy-photo-team" src={logo} alt="" />
      ) : null}
      {headshot ? (
        <img
          className={hero ? "hub-strategy-photo-player" : undefined}
          src={headshot}
          alt=""
          onError={() => setShotIndex((n) => n + 1)}
        />
      ) : !hero && logo ? (
        <img src={logo} alt="" />
      ) : (
        <div className="hub-strategy-photo-fallback">{playerInitials(name)}</div>
      )}
    </div>
  );
}

function FaceCard({ row, media, pickDraft, ctx, riskTolerance, onTake }) {
  const bid = suggestedBid(row);
  const stats = [];
  if (!pickDraft && ctx.draftType === "auction") {
    stats.push({
      label: COPY.bid,
      sub: suggestedBidSubLabel({ scoringProfile: ctx.scoringProfile, riskTolerance }),
      value: bid != null ? fmtSal(bid) : "—",
    });
  }
  stats.push(
    { label: COPY.p50, value: formatSeasonPts(row?.season_p50 ?? row?.season_proj) },
    { label: COPY.floor, value: formatSeasonPts(row?.season_p10) },
    { label: COPY.ceiling, value: formatSeasonPts(row?.season_p90) },
  );
  return (
    <article className="hub-strategy-card">
      <StrategyPhoto row={row} media={media} hero />
      <div className="hub-strategy-pad">
        <div className="hub-strategy-identity">
          <h3 className="hub-strategy-name">{playerName(row)}</h3>
          <p className="hub-strategy-meta">
            {[row.position, row.team, COPY.siteRank(row.site_rank)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="hub-strategy-stats" data-count={stats.length}>
          {stats.map((stat) => (
            <div key={stat.label} className="hub-strategy-stat">
              <span>{stat.label}{stat.sub ? <small> {stat.sub}</small> : null}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={onTake}>
          {takeLabel(row)}
        </button>
      </div>
    </article>
  );
}

function RankRow({ row, media, pickDraft, showMove = false }) {
  const bid = suggestedBid(row);
  const move = showMove ? formatRankMove(rankDelta(row)) : null;
  const trailing = move
    || (showMove ? COPY.siteRank(row.site_rank) : (pickDraft
      ? formatSeasonPts(row.season_p50 ?? row.season_proj)
      : (bid != null ? fmtSal(bid) : "—")));
  return (
    <div className="hub-strategy-row">
      <span className="hub-strategy-n">{showMove ? row.personal_rank : row.site_rank}</span>
      <StrategyPhoto row={row} media={media} className="hub-strategy-photo--avatar" />
      <div className="hub-strategy-row-name">{playerName(row)}</div>
      <span className={`hub-strategy-delta${move?.startsWith("▲") ? " is-up" : move?.startsWith("▼") ? " is-down" : ""}`}>
        {trailing}
      </span>
    </div>
  );
}

export default function StrategyBoard({
  rows,
  season,
  teamCount = 12,
  loading = false,
  rules = null,
  pickDraft = false,
  leagueId = "",
  inLeague = false,
  leagueName = "",
  riskTolerance = 0,
}) {
  const [page, setPage] = useState("faceoff");
  const [posFilter, setPosFilter] = useState("ALL");
  const [rankFocus, setRankFocus] = useState("mine");
  const [order, setOrder] = useState([]);
  const [seenKeys, setSeenKeys] = useState([]);
  const [feedMine, setFeedMine] = useState(false);
  const [history, setHistory] = useState([]);
  const [hydrated, setHydrated] = useState("");
  const [feedNote, setFeedNote] = useState("");
  const [feedError, setFeedError] = useState("");
  const [feedBusy, setFeedBusy] = useState(false);
  const lastWritten = useRef("");

  const ctx = useMemo(
    () => boardContext({
      season,
      teamCount,
      draftType: draftTypeFromRules(rules, pickDraft),
      scoringProfile: DEFAULT_SCORING_PROFILE,
    }),
    [season, teamCount, rules, pickDraft],
  );
  const fingerprint = useMemo(() => contextFingerprint(ctx), [ctx]);
  const siteBoard = useMemo(() => buildSiteBoard(rows, ctx), [rows, ctx]);
  const siteKey = useMemo(
    () => siteBoard.map((row) => String(row.player_id)).join("|"),
    [siteBoard],
  );
  const skipHydrate = !siteKey && loading;

  useEffect(() => {
    if (skipHydrate) return;
    const siteIds = siteKey ? siteKey.split("|") : [];
    const saved = loadRankState(leagueId, fingerprint);
    setOrder(mergeOrder(siteIds, saved.order.length ? saved.order : siteIds));
    setSeenKeys(saved.seenKeys);
    setFeedMine(saved.feedMine);
    setHistory([]);
    setHydrated(fingerprint);
  }, [leagueId, fingerprint, siteKey, skipHydrate]);

  useEffect(() => {
    if (hydrated !== fingerprint) return;
    saveRankState(leagueId, fingerprint, { order, seenKeys, feedMine });
  }, [leagueId, fingerprint, hydrated, order, seenKeys, feedMine]);

  const board = useMemo(() => applyOrder(siteBoard, order), [siteBoard, order]);
  const pair = useMemo(
    () => nextPair(board, { seenKeys, posFilter, ctx }),
    [board, seenKeys, posFilter, ctx],
  );
  const mediaIds = useMemo(() => siteBoard.map((row) => row.player_id), [siteBoard]);
  const media = usePlayerMedia(mediaIds);
  const siteOrdered = useMemo(
    () => [...board].sort((a, b) => a.site_rank - b.site_rank),
    [board],
  );
  const mineOrdered = useMemo(
    () => [...board].sort((a, b) => a.personal_rank - b.personal_rank),
    [board],
  );
  const movedCount = useMemo(
    () => board.filter((row) => rankDelta(row) !== 0).length,
    [board],
  );
  const line = contextLine({ ...ctx, leagueName });

  const writeQueue = useCallback(async (playerIds) => {
    if (!inLeague || !leagueId) {
      lastWritten.current = playerIds.join(",");
      return { ok: true, local: true };
    }
    const key = playerIds.join(",");
    if (lastWritten.current === key) return { ok: true, skipped: true };
    setFeedBusy(true);
    setFeedError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/nomination-queue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_ids: playerIds }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      lastWritten.current = key;
      return { ok: true };
    } catch (err) {
      setFeedError(err.message || COPY.feedError);
      return { ok: false };
    } finally {
      setFeedBusy(false);
    }
  }, [inLeague, leagueId]);

  useEffect(() => {
    if (hydrated !== fingerprint) return;
    if (!feedMine) return;
    let active = true;
    const ids = queueFromOrder(order);
    const timer = setTimeout(() => {
      writeQueue(ids).then((result) => {
        if (!active) return;
        if (!result?.ok || result.skipped) return;
        setFeedNote(result.local ? COPY.feedLocal : COPY.feedSaved);
      });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [feedMine, order, hydrated, fingerprint, writeQueue]);

  const setFeed = useCallback(async (next) => {
    setFeedMine(next);
    setFeedNote("");
    setFeedError("");
    if (!next) {
      const result = await writeQueue([]);
      if (result.ok) setFeedNote(result.local ? COPY.feedLocal : COPY.feedSite);
      return;
    }
    const result = await writeQueue(queueFromOrder(order));
    if (result.ok) setFeedNote(result.local ? COPY.feedLocal : COPY.feedSaved);
  }, [order, writeQueue]);

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev, { order, seenKeys }].slice(-20));
  }, [order, seenKeys]);

  const take = useCallback((winner, loser) => {
    if (!winner || !loser) return;
    pushHistory();
    const next = applyPick(order, winner.player_id, loser.player_id);
    setOrder(next.order);
    setSeenKeys((prev) => [...new Set([...prev, pairKey(winner.player_id, loser.player_id)])]);
  }, [order, pushHistory]);

  const skipPair = useCallback(() => {
    if (!pair) return;
    pushHistory();
    setSeenKeys((prev) => [...new Set([...prev, pair.key])]);
  }, [pair, pushHistory]);

  const undo = useCallback(() => {
    if (!history.length) return;
    const last = history[history.length - 1];
    setOrder(last.order);
    setSeenKeys(last.seenKeys);
    setHistory((prev) => prev.slice(0, -1));
  }, [history]);

  const resetSeen = useCallback(() => {
    pushHistory();
    setSeenKeys([]);
  }, [pushHistory]);

  useEffect(() => {
    if (page !== "faceoff") return undefined;
    const onKey = (event) => {
      if (event.target?.closest?.("input, textarea, select") || event.target?.isContentEditable) return;
      if (event.key === "ArrowLeft" && pair?.a) {
        event.preventDefault();
        take(pair.a, pair.b);
      } else if (event.key === "ArrowRight" && pair?.b) {
        event.preventDefault();
        take(pair.b, pair.a);
      } else if (event.key === "Escape" && pair) {
        event.preventDefault();
        skipPair();
      } else if (event.key === "Backspace") {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, pair, take, skipPair, undo]);

  const filters = (
    <HubFilterScroll className="hub-strategy-filters">
      {POS_FILTERS.map((id) => (
        <HubFilterChip
          key={id}
          compact
          active={posFilter === id}
          onClick={() => setPosFilter(id)}
        >
          {id === "ALL" ? COPY.filterAll : id === "FLEX" ? COPY.filterFlex : id}
        </HubFilterChip>
      ))}
    </HubFilterScroll>
  );

  return (
    <HubPage className="hub-strategy">
      {loading && !siteBoard.length ? (
        <p className="hub-page-meta">{COPY.loading}</p>
      ) : null}

      <HubAlertStack>
        {!ctx.scoringSupported ? <HubAlert variant="info">{COPY.scoringFallback}</HubAlert> : null}
        {feedError ? <HubAlert variant="danger">{feedError}</HubAlert> : null}
        {feedNote && !feedError ? <HubAlert variant="info">{feedNote}</HubAlert> : null}
      </HubAlertStack>

      {page === "rankings" ? (
        <>
          <div className="hub-strategy-feed">
            <div>
              <p className="hub-strategy-kicker">{COPY.eyebrow}</p>
              <h2 className="hub-strategy-title">{COPY.rankingsHeading}</h2>
              <p className="hub-strategy-support">{COPY.rankingsSupport}</p>
            </div>
            <div className="hub-strategy-toggle" role="group" aria-label={COPY.rankingsHeading}>
              <button
                type="button"
                className={`hub-strategy-toggle-btn${!feedMine ? " is-on" : ""}`}
                aria-pressed={!feedMine}
                disabled={feedBusy}
                onClick={() => setFeed(false)}
              >
                {COPY.useSite}
              </button>
              <button
                type="button"
                className={`hub-strategy-toggle-btn${feedMine ? " is-on" : ""}`}
                aria-pressed={feedMine}
                disabled={feedBusy}
                onClick={() => setFeed(true)}
              >
                {COPY.useMine}
              </button>
            </div>
          </div>
          <div className="hub-strategy-toolbar">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPage("faceoff")}>
              {COPY.backToCalls}
            </button>
            <div className="hub-strategy-rank-focus" role="group" aria-label={COPY.viewRankings}>
              <HubFilterChip compact active={rankFocus === "site"} onClick={() => setRankFocus("site")}>
                {COPY.site}
              </HubFilterChip>
              <HubFilterChip compact active={rankFocus === "mine"} onClick={() => setRankFocus("mine")}>
                {COPY.mine}
              </HubFilterChip>
            </div>
            <span className="hub-strategy-progress">
              {COPY.moved(movedCount)}
              {seenKeys.length ? ` · ${COPY.compared(seenKeys.length)}` : ""}
            </span>
          </div>
          {!siteBoard.length ? (
            <p className="hub-strategy-empty">{COPY.emptyBoard}</p>
          ) : (
            <div className="hub-strategy-split" data-focus={rankFocus}>
              <section className="hub-strategy-col" aria-label={COPY.site}>
                <h3>{COPY.site}</h3>
                <p className="hub-strategy-col-hint">{COPY.rankingsSiteHint(line)}</p>
                {siteOrdered.map((row) => (
                  <RankRow key={`site-${row.player_id}`} row={row} media={media} pickDraft={pickDraft} />
                ))}
              </section>
              <section className="hub-strategy-col is-mine" aria-label={COPY.mine}>
                <h3>{COPY.mine}</h3>
                <p className="hub-strategy-col-hint">{COPY.rankingsMineHint(seenKeys.length)}</p>
                {mineOrdered.map((row) => (
                  <RankRow key={`mine-${row.player_id}`} row={row} media={media} pickDraft={pickDraft} showMove />
                ))}
              </section>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="hub-strategy-toolbar">
            <div>
              <p className="hub-strategy-kicker">
                {pair
                  ? (pair.a?.position && pair.b?.position && pair.a.position !== pair.b.position
                    ? `${COPY.closeCall} · ${pair.a.position} vs ${pair.b.position}`
                    : `${COPY.closeCall}${pair.a?.position ? ` · ${pair.a.position}` : ""}`)
                  : COPY.eyebrow}
              </p>
              <p className="hub-strategy-context">{line}</p>
            </div>
            <div className="hub-strategy-toolbar-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={undo}
                disabled={!history.length}
              >
                {COPY.undo}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setPage("rankings")}
              >
                {COPY.viewRankings}
              </button>
            </div>
          </div>
          {filters}
          {!siteBoard.length && !loading ? (
            <p className="hub-strategy-empty">{COPY.emptyBoard}</p>
          ) : pair ? (
            <>
              <div className="hub-strategy-duel">
                <FaceCard
                  row={pair.a}
                  media={media}
                  pickDraft={pickDraft}
                  ctx={ctx}
                  riskTolerance={riskTolerance}
                  onTake={() => take(pair.a, pair.b)}
                />
                <div className="hub-strategy-or" aria-hidden>{COPY.vs}</div>
                <FaceCard
                  row={pair.b}
                  media={media}
                  pickDraft={pickDraft}
                  ctx={ctx}
                  riskTolerance={riskTolerance}
                  onTake={() => take(pair.b, pair.a)}
                />
              </div>
              <div className="hub-strategy-vote">
                <button type="button" className="btn btn-ghost btn-sm" onClick={skipPair}>
                  {COPY.tooClose}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={skipPair}>
                  {COPY.skip}
                </button>
              </div>
              <p className="hub-strategy-progress">
                {seenKeys.length ? COPY.compared(seenKeys.length) : COPY.heading}
                <span> · {COPY.keyboardHint}</span>
              </p>
            </>
          ) : (
            <div className="hub-strategy-empty-wrap">
              <p className="hub-strategy-empty">
                {posFilter === "ALL" ? COPY.emptyPairAll : COPY.emptyPair}
              </p>
              <div className="hub-strategy-toolbar-actions">
                <button type="button" className="btn btn-ghost" onClick={resetSeen}>
                  {COPY.resetSeen}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {ctx.scoringSupported ? (
        <p className="hub-strategy-footnote">{COPY.scoringFallback}</p>
      ) : null}
    </HubPage>
  );
}
