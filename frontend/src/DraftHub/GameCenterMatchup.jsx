import React, { useId, useState } from "react";
import { JerseySvg } from "./LockerRoomScene";
import { nflTeamColors } from "./nflTeamColors";
import { identityMediaUrl } from "./atmosphereCatalog";
import { identityFor } from "./TeamIdentityContext";
import IdentityCropMedia from "./IdentityCropMedia";
import TeamIdentityMark from "./TeamIdentityMark";
import WeekCulturePanel from "./WeekCulturePanel";
import {
  GAME_CENTER_COPY as COPY,
  duelSlotFilled,
  formatMatchupScore,
  formatSyncedAgo,
  gameCenterLead,
  gameCenterProjection,
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
const score = (p, placeholder) =>
  !duelSlotFilled(p)
    ? "—"
    : formatMatchupScore(p.points, { placeholder }).score;

function BannerArt({ identity, side }) {
  const src = identityMediaUrl(identity, "banner");
  return src ? (
    <div
      className={`gc-room-banner-art gc-room-banner-art--${side}`}
      aria-hidden="true"
    >
      <IdentityCropMedia
        key={src}
        src={src}
        focus={identity?.banner_focus}
        alt=""
      />
    </div>
  ) : null;
}
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
function FeaturedPlayer({ player, media, gradientId, placeholder }) {
  const filled = duelSlotFilled(player);
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
      <small>
        {[player?.team, player?.position].filter(Boolean).join(" · ")}
      </small>
      <h2>{filled ? player.name : COPY.emptySlot}</h2>
      <div className="gc-room-feature-score">
        <strong>{score(player, placeholder)}</strong>
        <span>{gameCenterProjection(player)}</span>
      </div>
    </div>
  );
}
function PlayerName({ player, away = false }) {
  return (
    <span
      className={`gc-room-player-name${away ? " gc-room-player-name--away" : ""}`}
    >
      <b>{duelSlotFilled(player) ? player.name : COPY.emptySlot}</b>
      <small>
        {[player?.team, player?.position].filter(Boolean).join(" · ")}
      </small>
    </span>
  );
}
function Points({ player, placeholder }) {
  return (
    <span className="gc-room-player-points">
      <b>{score(player, placeholder)}</b>
      <small>
        {player?.proj != null ? `Proj ${Number(player.proj).toFixed(1)}` : "—"}
      </small>
    </span>
  );
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
}) {
  const [section, setSection] = useState("starters");
  const [selectedKey, setSelectedKey] = useState(rows[0]?.key);
  const [detailSide, setDetailSide] = useState("home");
  const id = useId().replaceAll(":", "");
  const selected = rows.find((r) => r.key === selectedKey) || rows[0];
  const player = selected?.[detailSide];
  const mine = identityFor(identities, identityTeam(viewer));
  const theirs = identityFor(identities, identityTeam(opponent));
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
      {otherMatchups.map((m) => (
        <div className="gc-room-other-match" key={m.matchup_id}>
          {(m.teams || []).map((t) => (
            <div key={t.roster_id}>
              <span>{gameCenterTeamLabel(t)}</span>
              <b>{formatMatchupScore(t.points, { placeholder }).score}</b>
            </div>
          ))}
        </div>
      ))}
      {!otherMatchups.length && <p>{COPY.leagueSupport}</p>}
    </section>
  );
  return (
    <>
      <section className="gc-room-scoreboard" aria-label="Matchup score">
        <BannerArt identity={mine} side="home" />
        <BannerArt identity={theirs} side="away" />
        <TeamName team={viewer} identity={mine} />
        <div className="gc-room-score" aria-live="polite" aria-atomic="true">
          <strong>
            {formatMatchupScore(viewer.points, { placeholder }).score}
          </strong>
          <div>
            <span className={stateLabel === "Live" ? "gc-room-live" : ""}>
              {stateLabel}
            </span>
            <small>{gameCenterLead(viewer, opponent, placeholder)}</small>
          </div>
          <strong>
            {formatMatchupScore(opponent.points, { placeholder }).score}
          </strong>
        </div>
        <TeamName team={opponent} identity={theirs} away />
        <div className="gc-room-score-foot">
          <span>{COPY.scoreSource}</span>
          <span>{formatSyncedAgo(data.synced_at)}</span>
        </div>
      </section>
      <div className="gc-room-toolbar">
        <div
          className="gc-room-segments"
          role="group"
          aria-label="Matchup view"
        >
          {["starters", "bench", "league"].map((tab) => (
            <button
              key={tab}
              aria-pressed={section === tab}
              onClick={() => setSection(tab)}
            >
              {COPY[tab]}
            </button>
          ))}
        </div>
        {onNavigate && (
          <button className="btn-link" onClick={() => onNavigate("week")}>
            {COPY.reviewLineup}
          </button>
        )}
      </div>
      <div className="gc-room-layout">
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
                    <Points player={row.home} placeholder={placeholder} />
                    <span className="gc-room-slot">{row.slot}</span>
                    <Points player={row.away} placeholder={placeholder} />
                    <PlayerName player={row.away} away />
                  </button>
                ))}
                {!rows.length && (
                  <p className="gc-room-empty">{COPY.emptyDuel}</p>
                )}
              </section>
              <p className="gc-room-note">{COPY.forecastNote}</p>
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
                        <Points player={p} placeholder={placeholder} />
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
                <strong>{score(player, placeholder)}</strong>
                <small>{COPY.points}</small>
              </div>
              <p>{gameCenterProjection(player)}</p>
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
        </aside>
      </div>
    </>
  );
}
