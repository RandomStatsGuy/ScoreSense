import "./styles/player-details.css";
import "./styles/player-profile.css";
import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import PlayerCell from "./PlayerCell";
import ProjectionExplanationPanel from "./ProjectionExplanationPanel";
import PlayerContextPanel from "./PlayerContextPanel";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "./format";
import PlayerCardFrame from "./PlayerCardFrame";
import {isByeWeek} from "./weeklyAvailability";
import Chip, { injuryChipTone } from "./Chip";
import { BOARD_COPY, PLAYER_CARD_COPY as COPY, filterInspectorCandidates, playerCardInjuryCode,
  playerCardNumber as number, playerCardPace, playerCardRequestKey, positionShort, weeklyQuantiles } from "./projectionsPresentation";
import { HubLoadingSkeleton } from "./DraftHub/HubUILayout";

function ForecastRange({ band }) {
  if (![band?.p10, band?.p50, band?.p90].every(Number.isFinite)) return null;
  const marker = band.p90 > band.p10 ? Math.max(0, Math.min(100, (band.p50 - band.p10) / (band.p90 - band.p10) * 100)) : 50;
  return <div className="player-profile-range">
    <span>{BOARD_COPY.floor} <strong>{number(band.p10)}</strong></span>
    <span className="player-profile-range-track" aria-hidden="true"><i style={{ left: `${marker}%` }} /></span>
    <span>{BOARD_COPY.ceiling} <strong>{number(band.p90)}</strong></span>
  </div>;
}

function PlayerGameLog({ data, position }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [data?.player_id, data?.meta?.season]);
  const rows = data?.game_log || [];
  const qb = String(position).toLowerCase() === "qb";
  const rb = String(position).toLowerCase() === "rb";
  const columns = qb ? [[COPY.pass, "passing_yards"], [COPY.rush, "rushing_yards"]]
    : rb ? [[COPY.rush, "rushing_yards"], [COPY.receiving, "receiving_yards"]]
      : [[COPY.rec, "receptions"], [COPY.receiving, "receiving_yards"]];
  const visible = expanded ? rows : rows.slice(0, 5);
  return <section className="player-profile-log" aria-label={COPY.gameLog}>
    <div className="player-profile-section-head"><h2>{COPY.gameLog}</h2><span>{data?.game_log_season ?? data?.meta?.season} · {COPY.regularSeason}</span></div>
    {rows.length ? <>
      <table className="player-profile-table"><caption className="sr-only">{COPY.logCaption}</caption><thead><tr>
        <th scope="col" className="num">{COPY.weekColumn}</th><th scope="col" data-column-type="text">{COPY.opponent}</th>
        {columns.map(([label, key]) => <th scope="col" className="num" key={key}>{label}</th>)}<th scope="col" className="num">{COPY.touchdowns}</th><th scope="col" className="num">{COPY.pts}</th>
      </tr></thead><tbody>{visible.map(row => <tr key={row.week}>
        <td className="num">{row.week}</td><td data-column-type="text">{row.opponent ? `${row.is_home === false ? "@ " : ""}${row.opponent}` : "—"}</td>
        {columns.map(([, key]) => <td className="num" key={key}>{number(row[key], 0)}</td>)}<td className="num">{number(row.touchdowns, 0)}</td><td className="num">{number(row.points)}</td>
      </tr>)}</tbody></table>
      {rows.length > 5 ? <button className="btn-ghost player-profile-more" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? COPY.fewerGames : `${COPY.allGames} (${rows.length})`}</button> : null}
    </> : <p className="player-profile-empty">{COPY.noGames}</p>}
  </section>;
}

function PlayerCardBody({ data, loading, error, fallbackName, request, onRetry }) {
  const [timeframe, setTimeframe] = useState("week");
  const [notesOpen, setNotesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const preseason = data?.meta?.preseason_mode === true;
  useEffect(() => { setTimeframe(preseason ? "preseason" : "week"); setNotesOpen(false); setDetailsOpen(false); }, [request?.playerId, request?.season, request?.week, preseason]);
  const playerId = data?.player_id || request?.playerId;
  const position = request?.position || data?.position;
  const summary = data?.season_to_date;
  const pace = playerCardPace(summary, data?.preseason_baseline);
  const code = playerCardInjuryCode(data?.injury?.injury_status);
  const weekly = weeklyQuantiles(data?.weekly_projection);
  const preview = request?.scope !== "season" ? request?.preview : null;
  const bye = isByeWeek(data?.weekly_projection) || (!data && preview?.bye === true);
  const weekBand = !data && preview ? preview : weekly;
  const band = timeframe === "ros" ? data?.rest_of_season_projection : timeframe === "preseason" ? data?.preseason_projection : weekBand;
  const season = data?.meta?.season ?? request?.season;
  const week = data?.meta?.week ?? request?.week;
  const selected = preseason ? "preseason" : timeframe;
  const label = selected === "season" ? `${season} · ${COPY.recorded}` : selected === "ros" ? COPY.ros : selected === "preseason" ? `${season} ${COPY.preseason.toLowerCase()}` : `${COPY.week} ${week ?? "—"}${bye ? "" : ` ${COPY.projection}`}`;
  const tabs = COPY.tabs;
  const changeTab = (index, focus = false) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    setTimeframe(tab.id); setDetailsOpen(false);
    if (focus) document.getElementById(`player-timeframe-${tab.id}`)?.focus();
  };
  return <div className="player-card-body player-profile">
    <header className="player-profile-identity">
      <PlayerCell name={data?.player_name || fallbackName} team={data?.team || request?.team} playerId={playerId}
        media={data?.media && playerId ? { [playerId]: data.media } : null} size="lg" showTeam={false} position={positionShort(position)} />
      {code ? <details className="player-profile-injury" key={playerId}>
        <summary aria-label={`${data.injury.injury_status} · ${COPY.injuryDetails}`}><Chip tone={injuryChipTone(data.injury.injury_status)}>{code}</Chip></summary>
        <div className="player-profile-injury-detail"><strong>{data.injury.injury_status}{data.injury.injury_body_part ? ` · ${data.injury.injury_body_part}` : ""}</strong>
          {data.injury.practice_participation ? <p>{data.injury.practice_participation}</p> : null}
          {data.injury.injury_notes ? <p>{data.injury.injury_notes}</p> : null}</div>
      </details> : null}
    </header>
    {!preseason ? <div className="player-profile-tabs" role="tablist" aria-label={COPY.timeframe}>{tabs.map((tab, index) => <button
      key={tab.id} id={`player-timeframe-${tab.id}`} type="button" role="tab" aria-selected={selected === tab.id} aria-controls="player-timeframe-panel"
      tabIndex={selected === tab.id ? 0 : -1} onClick={() => changeTab(index)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next != null) { event.preventDefault(); changeTab(next, true); }
      }}>{tab.label}</button>)}</div> : null}
    {loading && !data && !preview ? <HubLoadingSkeleton rows={3} /> : <section id="player-timeframe-panel" className="player-profile-forecast"
      role={preseason ? undefined : "tabpanel"} aria-labelledby={preseason ? undefined : `player-timeframe-${selected}`}>
      <p className="player-profile-eyebrow">{label}</p>
      {selected === "season" ? <>
        <div className="player-profile-totals"><div><p className="player-profile-number">{number(summary?.points)}</p><p className="player-profile-unit">{COPY.points}</p></div>
          <div className="player-profile-ppg"><strong>{number(summary?.ppg)}</strong><span>{COPY.ppg}</span></div></div>
        {Number.isFinite(summary?.games_played) ? <p className="player-profile-unit">{summary.games_played} {COPY.gamesPlayed}{summary.through_week ? ` · ${COPY.through} ${summary.through_week}` : ""}</p> : null}
        {pace ? <p className={`player-profile-pace player-profile-pace--${pace.tone}`}>{pace.label}</p> : summary?.complete ? <p className="player-profile-unit">{COPY.missingBaseline}</p> : null}
        {summary?.games_played && !summary.complete ? <p className="player-profile-unit">{COPY.incomplete}</p> : null}
      </> : <>
        <p className="player-profile-number">{selected==="week"&&bye?COPY.bye:number(band?.p50, selected === "preseason" ? 0 : 1)}</p>
        <p className="player-profile-unit">{selected==="week"&&bye?COPY.byeNote:Number.isFinite(band?.p50) ? COPY.ppr : COPY.noProjection}
          {selected === "ros" && Number.isFinite(band?.games_remaining) ? ` · ${band.games_remaining} ${COPY.gamesRemaining}` : ""}
          {selected === "week" && !bye && formatRelativeTime(data?.meta?.built_at) ? ` · ${formatRelativeTime(data.meta.built_at)}` : ""}</p>
        <ForecastRange band={band} />
      </>}
    </section>}
    {error ? <div className="error" role="alert"><span>{error}</span> <button type="button" className="btn-ghost" onClick={onRetry}>{COPY.retry}</button></div> : null}
    {data ? <PlayerGameLog data={data} position={position} /> : null}
    {data ? <details className="player-profile-disclosure" open={notesOpen} onToggle={event => setNotesOpen(event.currentTarget.open)}>
      <summary><span>{COPY.notes}</span><span className="player-profile-plus" aria-hidden="true" /></summary>
      {notesOpen && playerId ? <PlayerContextPanel playerId={playerId} season={season} week={week} active variant="notes" /> : null}
    </details> : null}
    {data && selected!=="preseason" && !(selected==="week"&&bye) ? <details className="player-profile-disclosure" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary><span>{selected === "season" ? COPY.comparison : COPY.details}</span><span className="player-profile-plus" aria-hidden="true" /></summary>
      {detailsOpen ? <div className="player-profile-detail-body">
        {selected === "season" ? pace ? <><p>{COPY.baselineExplanation}</p><p>{number(data.preseason_baseline.points)} {COPY.points} · {data.preseason_baseline.games} {COPY.scheduledGames}</p></> : <p>{COPY.missingBaseline}</p>
          : selected === "ros" ? <p>{COPY.remainingExplanation}</p> : null}
        {selected === "week" && playerId && data?.weekly_projection ? <ProjectionExplanationPanel playerId={playerId} season={season} week={week}
          position={position} applyInjuryAdjustments={request?.applyInjuryAdjustments ?? true} active className="projection-explanation--card" /> : null}
      </div> : null}
    </details> : null}
  </div>;
}

function InspectorSearch({ request, onSelect, candidates = [] }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => (query.trim() ? filterInspectorCandidates(candidates, query) : []),
    [candidates, query],
  );

  useEffect(() => {
    setQuery("");
  }, [request?.playerId]);

  return (
    <div className="player-inspector-search">
      <label className="sr-only" htmlFor="player-inspector-search">
        {BOARD_COPY.searchInspector}
      </label>
      <input
        id="player-inspector-search"
        type="search"
        className="search-input"
        placeholder={BOARD_COPY.searchInspector}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length ? (
        <ul className="player-inspector-search-list">
          {matches.map((hit) => (
            <li key={hit.playerId}>
              <button
                type="button"
                onClick={() => {
                  onSelect?.(hit);
                  setQuery("");
                }}
              >
                {hit.name}
                {hit.team ? ` · ${hit.team}` : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function PlayerCardModal({
  request,
  onClose,
  candidates = [],
  compareIds = [],
  onToggleCompare,
  maxCompare = 4,
  onSelectPlayer,
}) {
  const requestKey = playerCardRequestKey(request);
  const [snapshot, setSnapshot] = useState({key:"", data:null, loading:false, error:""});
  const [retry, setRetry] = useState(0);
  const current = snapshot.key === requestKey;
  const data = current ? snapshot.data : null;
  const error = current ? snapshot.error : "";
  const loading = Boolean(request?.playerId && (!current || snapshot.loading));
  useEffect(() => {
    if (!request?.playerId) return undefined;
    const controller = new AbortController();
    setSnapshot({key:requestKey, data:null, loading:true, error:""});
    (async () => {
      try {
        const params = new URLSearchParams();
        if (request.season != null) params.set("season", String(request.season));
        if (request.week != null) params.set("week", String(request.week));
        if (request.scope) params.set("scope", request.scope);
        if (request.position) params.set("position", request.position);
        params.set("apply_injury_adjustments", (request.applyInjuryAdjustments ?? true) ? "true" : "false");
        const res = await apiFetch(`/api/player/${encodeURIComponent(request.playerId)}/card?${params}`, {signal:controller.signal});
        if (!res.ok) throw new Error(await parseApiError(res, "Failed to load player card"));
        const payload = await res.json();
        if (!controller.signal.aborted) setSnapshot({key:requestKey, data:payload, loading:false, error:""});
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return;
        setSnapshot({key:requestKey, data:null, loading:false, error:connectionErrorMessage(err, "Failed to load player card")});
      }
    })();
    return () => controller.abort();
  }, [requestKey, retry]);

  if (!request) return null;

  const title = data?.player_name || request.playerName || "Player";
  const selectPlayer = (hit) => {
    onSelectPlayer?.({
      playerId: hit.playerId,
      name: hit.name,
      team: hit.team,
      position: hit.position || request.position,
      season: request.season,
      week: request.week,
      scope: request.scope,
      applyInjuryAdjustments: request.applyInjuryAdjustments,
      seasonMode: request.seasonMode,
      rank: hit.rank ?? null,
      preview: hit.preview || null,
    });
  };

  const selectedSet = (compareIds || []).map(String);
  const selected = selectedSet.includes(String(request.playerId));
  const bye = isByeWeek(data?.weekly_projection) || request?.preview?.bye === true;
  const canAdd = Boolean(onToggleCompare) && (selected || (!bye && selectedSet.length < maxCompare));

  const body = (
    <div className="player-inspector player-inspector--profile">
      <div className="player-inspector-toolbar">
        <InspectorSearch request={request} onSelect={selectPlayer} candidates={candidates} />
        <button type="button" className="btn-ghost player-inspector-close" onClick={onClose} aria-label={COPY.close}>
          ×
        </button>
      </div>
      <div className="player-inspector-scroll">
        <PlayerCardBody
          data={data}
          loading={loading}
          error={error}
          fallbackName={request.playerName}
          request={request}
          onRetry={() => setRetry(value => value + 1)}
        />
      </div>
      <div className="player-inspector-footer">
        <span className="player-profile-scoring">{COPY.scoring}</span>
        {canAdd ? (
          <button
            type="button"
            className="player-inspector-add"
            onClick={() => onToggleCompare({
              player_id: request.playerId,
              Player: title,
              Team: request.team,
            })}
          >
            {selected ? COPY.removeCompare : `${COPY.compare} +`}
          </button>
        ) : null}
      </div>
    </div>
  );

  return <PlayerCardFrame title={title} onClose={onClose}>{body}</PlayerCardFrame>;
}
