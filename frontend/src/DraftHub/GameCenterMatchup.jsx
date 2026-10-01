import React, { useId, useState } from "react";
import { JerseySvg } from "./LockerRoomScene";
import { nflTeamColors } from "./nflTeamColors";
import { identityFor } from "./TeamIdentityContext";
import MatchupBannerArt from "./MatchupBannerArt";
import NflTeamMark from "./NflTeamMark";
import TeamIdentityMark from "./TeamIdentityMark";
import WeekCulturePanel from "./WeekCulturePanel";
import {
  GAME_CENTER_COPY as COPY,
  duelSlotFilled,
  formatMatchupScore,
  formatSyncedAgo,
  gameCenterLead,
  gameCenterPlayerScore,
  gameCenterMatchupScores,
  gameCenterMatchupLead,
  gameCenterTeamLabel,
  gameCenterTeamParts,
  formatStandingRank,
  formatStandingRecord,
} from "./gameCenterPresentation";

const identityTeam = (t) => ({
  id: t?.hub_team_id || t?.roster_id,
  name: t?.team_name,
  owner_name: t?.owner_name,
});

function TeamName({ team, identity, away = false }) {
  const parts = gameCenterTeamParts(team);
  return (
    <div className={`gc-room-team${away ? " gc-room-team--away" : ""}`}>
      <TeamIdentityMark
        team={identityTeam(team)}
        identity={identity}
        size="lg"
      />
      <div>
        <small>{parts.owner}</small>
        <h2>{parts.team || gameCenterTeamLabel(team)}</h2>
      </div>
    </div>
  );
}
function FeaturedPlayer({ player, media, gradientId, placeholder, data }) {
  const filled = duelSlotFilled(player);
  const metric = gameCenterPlayerScore(player, data, placeholder);
  return (
    <div className="gc-room-feature-player">
      <div className="gc-room-jersey">
        <JerseySvg
          detailed
          colors={nflTeamColors(player?.team).jersey}
          number={
            filled
              ? (media?.[player.player_id]?.jersey_number ??
                player.jersey_number)
              : null
          }
          gradientId={gradientId}
        />
      </div>
      <small className="gc-room-player-meta">
        <NflTeamMark team={player?.team} />
        {[player?.team, player?.position].filter(Boolean).join(" · ")}
      </small>
      <h2>{filled ? player.name : COPY.emptySlot}</h2>
      <div className="gc-room-feature-score">
        <strong>{metric.value}</strong>
        <span>{metric.label}<small>{metric.secondary}</small></span>
      </div>
    </div>
  );
}
function PlayerName({ player, away = false }) {
  return (
    <span
      className={`gc-room-player-name${away ? " gc-room-player-name--away" : ""}`}
    >
      <NflTeamMark team={player?.team} />
      <span><b>{duelSlotFilled(player) ? player.name : COPY.emptySlot}</b>
      <small>
        {[player?.team, player?.position].filter(Boolean).join(" · ")}
      </small>
      </span>
    </span>
  );
}
function Points({ player, placeholder, data }) {
  const metric = gameCenterPlayerScore(player, data, placeholder);
  return <span className="gc-room-player-points" title={`${metric.label} · ${metric.secondary}`}>
    <b>{metric.value}</b>
    <small>{metric.state === "pregame" ? COPY.currentForecast : metric.secondary}</small>
  </span>;
}
function ReadOnlyLineup({ viewer, data, placeholder }) {
  return <section className="gc-room-panel gc-room-readonly-lineup" aria-label={COPY.lineupTitle}>
    <div className="gc-room-section-head"><h2>{gameCenterTeamLabel(viewer)}</h2><small>{COPY.lineupTitle}</small></div>
    {(viewer?.starters || []).map((player, index) => <div className="gc-room-lineup-player" key={player.player_id || index}>
      <span className="gc-room-slot">{data.starting_slots?.[index] || player.position}</span>
      <PlayerName player={player} /><Points {...{player, data, placeholder}} />
    </div>)}
    {!viewer?.starters?.length && <p>{COPY.emptyDuel}</p>}
  </section>;
}
export default function GameCenterMatchup({
  data,
  viewer,
  opponent,
  rows,
  media,
  identities,
  placeholder,
  stateLabel,
  otherMatchups,
  standingRows,
  standingsView,
  onNavigate,
  hubContext,
  scoringControl,
  weekly = false,
  lineup,
  showReadOnlyLineup = false,
  onSelectMatchup,
  ownMatchupId,
  selectedMatchupId,
  activeSection,
  onSectionChange,
}) {
  const [localSection, setLocalSection] = useState(weekly && lineup ? "lineup" : "starters");
  const section = activeSection ?? localSection;
  const setSection = onSectionChange || setLocalSection;
  const [selectedKey, setSelectedKey] = useState(rows[0]?.key);
  const [detailSide, setDetailSide] = useState("home");
  const id = useId().replaceAll(":", "");
  const selected = rows.find((r) => r.key === selectedKey) || rows[0];
  const player = selected?.[detailSide];
  const mine = identityFor(identities, identityTeam(viewer));
  const theirs = identityFor(identities, identityTeam(opponent));
  const scores = gameCenterMatchupScores(viewer, opponent, data, placeholder);
  const pregame = scores.home.pregame && scores.away.pregame;
  const games = data.matchups || [];
  const gameIndex = games.findIndex(m => String(m.matchup_id) === String(selectedMatchupId));
  const isOwn = viewer?.is_viewer || String(viewer?.hub_team_id) === String(hubContext?.team_id);
  const opponentName = gameCenterTeamParts(opponent).owner || gameCenterTeamLabel(opponent);
  const matchupName = isOwn ? COPY.youVersus(opponentName) : `${gameCenterTeamParts(viewer).owner || gameCenterTeamLabel(viewer)} vs ${opponentName}`;
  const select = (key) => {
    setSelectedKey(key);
    setDetailSide("home");
  };
  const around = (
    <section className="gc-room-panel">
      <div className="gc-room-section-head">
        <h2>{COPY.leagueTitle}</h2>
        <small>Week {data.week}</small>
      </div>
      {(section === "league" ? games : otherMatchups).map((m) => {
        const totals = gameCenterMatchupScores(m.teams?.[0], m.teams?.[1], data, placeholder);
        const labels = (m.teams || []).map(gameCenterTeamLabel);
        return <button type="button" className="gc-room-other-match" key={m.matchup_id}
          aria-label={`${COPY.viewMatchup}: ${labels.join(" vs ")}`} onClick={() => onSelectMatchup?.(m.matchup_id)}>
          {(m.teams || []).map((t, i) => <span className="gc-room-other-team" key={t.roster_id}>
            <span title={labels[i]}>{labels[i]}</span><b>{(i === 0 ? totals.home : totals.away).value}</b>
          </span>)}
        </button>;
      })}
      {!otherMatchups.length && <p>{COPY.leagueSupport}</p>}
    </section>
  );
  return (
    <>
      {!weekly && <section className="gc-room-scoreboard" aria-label="Matchup score">
        <MatchupBannerArt identity={mine} side="home" />
        <MatchupBannerArt identity={theirs} side="away" />
        <TeamName team={viewer} identity={mine} />
        <div className="gc-room-score" aria-live="polite" aria-atomic="true">
          <strong>
            {pregame ? (forecast.mine == null ? "—" : forecast.mine.toFixed(1)) : formatMatchupScore(viewer.points, { placeholder }).score}
          </strong>
          <div>
            <span className={stateLabel === "Live" ? "gc-room-live" : ""}>
              {pregame ? COPY.projectedTotals : stateLabel}
            </span>
            {!pregame && <small>{gameCenterLead(viewer, opponent, placeholder)}</small>}
          </div>
          <strong>
            {pregame ? (forecast.theirs == null ? "—" : forecast.theirs.toFixed(1)) : formatMatchupScore(opponent.points, { placeholder }).score}
          </strong>
        </div>
        <TeamName team={opponent} identity={theirs} away />
        {!pregame && <div className="gc-room-score-foot">
          <span>{COPY.scoreSource}</span>
          <span>{formatSyncedAgo(data.synced_at)}</span>
        </div>}
      </section>}
      {weekly && <section className="hub-week-forecast" aria-label={pregame ? COPY.projectedTotals : stateLabel}>
        <span className="hub-week-forecast-opponent">{matchupName}</span>
        <div className="hub-week-forecast-totals" aria-live="polite" aria-atomic="true">
          <strong>{scores.home.value}<small aria-hidden="true">—</small>{scores.away.value}</strong>
          <small>{pregame ? COPY.projectedTotals : stateLabel}</small>
        </div>
        <span className="hub-week-forecast-status">{gameCenterMatchupLead(viewer, opponent, data, placeholder)}</span>
      </section>}
      {onSelectMatchup && games.length > 1 && <nav className="gc-room-game-nav" aria-label={COPY.browseGames}>
        <button type="button" className="btn-ghost" aria-label={COPY.previousGame} onClick={() => onSelectMatchup(games[(gameIndex - 1 + games.length) % games.length].matchup_id)}>←</button>
        <span>{COPY.matchupPosition(gameIndex + 1, games.length)}</span>
        <button type="button" className="btn-ghost" aria-label={COPY.nextGame} onClick={() => onSelectMatchup(games[(gameIndex + 1) % games.length].matchup_id)}>→</button>
        {String(ownMatchupId) !== String(selectedMatchupId) && ownMatchupId != null && <button type="button" className="btn-link" onClick={() => onSelectMatchup(ownMatchupId)}>{COPY.yourMatchup}</button>}
      </nav>}
      {!weekly && scoringControl}
      <div className="gc-room-toolbar">
        <div
          className="gc-room-segments"
          role="group"
          aria-label="Matchup view"
        >
          {(weekly ? [...(lineup ? ["lineup"] : []), "starters", "league"] : ["starters", "bench", "league"]).map((tab) => (
            <button
              key={tab}
              aria-pressed={section === tab}
              onClick={() => setSection(tab)}
            >
              {weekly && tab === "starters" ? COPY.matchup : COPY[tab]}
            </button>
          ))}
        </div>
        {onNavigate && !weekly && (
          <button className="btn-link" onClick={() => onNavigate("week")}>
            {COPY.reviewLineup}
          </button>
        )}
      </div>
      {section === "lineup" && showReadOnlyLineup && <ReadOnlyLineup {...{viewer, data, placeholder}} />}
      {section !== "lineup" && <div className="gc-room-layout">
        <div className="gc-room-main">
          {section === "starters" && (
            <>
              {selected && (
                <>
                  <div
                    className="gc-room-position-strip"
                    role="group"
                    aria-label={COPY.selectPosition}
                  >
                    {rows.map((row) => (
                      <button
                        key={row.key}
                        aria-pressed={row.key === selected.key}
                        onClick={() => select(row.key)}
                        aria-label={`${row.slot}: ${row.home?.name || COPY.emptySlot} versus ${row.away?.name || COPY.emptySlot}`}
                      >
                        <span>{row.slot}</span>
                        <small>
                          {row.home?.name?.split(" ").slice(-1)[0] || "—"}
                        </small>
                      </button>
                    ))}
                  </div>
                  <section
                    className="gc-room-feature"
                    aria-label={COPY.headToHead}
                  >
                    <FeaturedPlayer
                      player={selected.home}
                      media={media}
                      gradientId={`${id}-home`}
                      placeholder={placeholder}
                      data={data}
                    />
                    <div className="gc-room-versus">
                      {selected.slot}
                      <small>{COPY.headToHead}</small>
                    </div>
                    <FeaturedPlayer
                      player={selected.away}
                      media={media}
                      gradientId={`${id}-away`}
                      placeholder={placeholder}
                      data={data}
                    />
                  </section>
                </>
              )}
              <section className="gc-room-board" aria-label={COPY.everyStarter}>
                <div className="gc-room-section-head">
                  <h2>{COPY.everyStarter}</h2>
                  <small>{COPY.selectPosition}</small>
                </div>
                {rows.map((row) => (
                  <button
                    key={row.key}
                    className="gc-room-duel"
                    aria-pressed={row.key === selected?.key}
                    onClick={() => select(row.key)}
                    aria-label={`Compare ${row.home?.name || COPY.emptySlot} and ${row.away?.name || COPY.emptySlot}`}
                  >
                    <PlayerName player={row.home} />
                    <Points player={row.home} placeholder={placeholder} data={data} />
                    <span className="gc-room-slot">{row.slot}</span>
                    <Points player={row.away} placeholder={placeholder} data={data} />
                    <PlayerName player={row.away} away />
                  </button>
                ))}
                {!rows.length && (
                  <p className="gc-room-empty">{COPY.emptyDuel}</p>
                )}
              </section>
              <p className="gc-room-note">{COPY.forecastNote}</p>
              {weekly && <button type="button" className="btn-link" onClick={() => setSection("bench")}>{COPY.benchTitle}</button>}
            </>
          )}
          {section === "bench" && (
            <section className="gc-room-panel">
              <h2>{COPY.benchTitle}</h2>
              <p>{COPY.benchNote}</p>
              <div className="gc-room-bench">
                {[viewer, opponent].map((team) => (
                  <div key={team.roster_id}>
                    <h3>{gameCenterTeamLabel(team)}</h3>
                    {(team.bench_players || []).map((p, i) => (
                      <div
                        className="gc-room-bench-player"
                        key={p.player_id || i}
                      >
                        <PlayerName player={p} />
                        <Points player={p} placeholder={placeholder} data={data} />
                      </div>
                    ))}
                    {!team.bench_players?.length && <p>{COPY.noBench}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {section === "league" && around}
        </div>
        <aside className="gc-room-side">
          {section === "starters" && selected && (
            <section className="gc-room-panel gc-room-selected">
              <small>{COPY.selectedPlayer}</small>
              <div
                className="gc-room-segments"
                role="group"
                aria-label="Player details team"
              >
                {["home", "away"].map((side) => (
                  <button
                    key={side}
                    aria-pressed={detailSide === side}
                    onClick={() => setDetailSide(side)}
                  >
                    {gameCenterTeamParts(side === "home" ? viewer : opponent)
                      .owner ||
                      gameCenterTeamLabel(side === "home" ? viewer : opponent)}
                  </button>
                ))}
              </div>
              <h2>{player?.name || COPY.emptySlot}</h2>
              <div className="gc-room-detail-total">
                <strong>{gameCenterPlayerScore(player, data, placeholder).value}</strong>
                <small>{gameCenterPlayerScore(player, data, placeholder).label}</small>
              </div>
              <p>{gameCenterPlayerScore(player, data, placeholder).label} · {gameCenterPlayerScore(player, data, placeholder).secondary}</p>
              <p>{COPY.forecastNote}</p>
            </section>
          )}
          {section !== "league" && around}
          <details className="gc-room-panel">
            <summary>{COPY.standingsAwards}</summary>
            <h2>
              {standingsView.historical
                ? COPY.standingsLastSeason
                : COPY.standingsTitle}
            </h2>
            <p>{standingsView.note}</p>
            <ol className="gc-room-standings">
              {standingRows.map((row) => (
                <li key={row.roster_id}>
                  <small>
                    {formatStandingRank(row, { ranked: standingsView.ranked })}
                  </small>
                  <span>{gameCenterTeamLabel(row)}</span>
                  <small>{formatStandingRecord(row)}</small>
                </li>
              ))}
            </ol>
            <WeekCulturePanel
              hubContext={hubContext}
              week={data.week}
              boardReady
              title={COPY.trophiesTitle}
              support={COPY.trophiesSupport}
            />
          </details>
          {weekly && <details className="gc-room-panel"><summary>{COPY.weeklyExtras}</summary>
            <button type="button" className="btn-link" onClick={() => onNavigate?.("vibes")}>{COPY.ratePlayers}</button>
            {scoringControl}
          </details>}
        </aside>
      </div>}
    </>
  );
}
