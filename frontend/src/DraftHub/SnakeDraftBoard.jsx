import React, { useEffect, useMemo, useRef, useState } from "react";
import { teamLogoUrl, playerInitials } from "./draftMedia";
import {
  buildDraftBoard,
  formatPickLabel,
  isPickDraftType,
} from "./snakeDraftBoard";

function CellMark({ nflTeam, playerName }) {
  const src = teamLogoUrl(nflTeam);
  if (src) {
    return <img className="hub-pick-board-mark" src={src} alt="" />;
  }
  return <span className="hub-pick-board-initials" aria-hidden>{playerInitials(playerName)}</span>;
}

export default function SnakeDraftBoard({
  nominationOrder,
  teams,
  events,
  draftType,
  currentOverall,
  viewerTeamId,
  rules,
  mediaByPlayerId,
  compactDefault = true,
  variant = "live",
}) {
  const type = String(draftType || rules?.draft_type || "").toLowerCase();
  const enabled = isPickDraftType(type);

  const board = useMemo(
    () => (enabled
      ? buildDraftBoard({
        nominationOrder,
        teams,
        events,
        draftType: type,
        currentOverall,
        viewerTeamId,
        rules,
      })
      : { rows: [], columns: [], totalRounds: 0, teamCount: 0, currentRound: 1, currentOverall: 0, nextPick: null, snake: false }),
    [enabled, nominationOrder, teams, events, type, currentOverall, viewerTeamId, rules],
  );

  const [focusRound, setFocusRound] = useState(board.currentRound || 1);
  const [fullBoard, setFullBoard] = useState(!compactDefault);
  const scrollerRef = useRef(null);
  const activeRef = useRef(null);

  useEffect(() => {
    setFocusRound(board.currentRound || 1);
  }, [board.currentRound]);

  useEffect(() => {
    const node = activeRef.current;
    const scroller = scrollerRef.current;
    if (!node || !scroller) return undefined;
    const id = window.requestAnimationFrame(() => {
      node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [board.currentOverall, board.currentRound, fullBoard, focusRound]);

  const visibleRows = useMemo(() => {
    if (fullBoard) return board.rows;
    const start = Math.max(0, (focusRound || 1) - 1);
    return board.rows.slice(start, start + 1);
  }, [board.rows, fullBoard, focusRound]);

  if (!enabled) return null;

  const next = board.nextPick;
  const summary = next
    ? (next.isCurrent
      ? "You're on the clock"
      : `Your next pick: ${next.label} · ${next.picksAway} pick${next.picksAway === 1 ? "" : "s"} away`)
    : `${board.totalRounds} rounds · ${board.teamCount} teams`;

  const goCurrent = () => {
    setFocusRound(board.currentRound || 1);
    setFullBoard(false);
  };

  return (
    <section
      className={`hub-pick-board${variant === "recap" ? " hub-pick-board--recap" : ""}`}
      aria-label={`${board.snake ? "Snake" : "Linear"} draft board`}
    >
      <header className="hub-pick-board-toolbar">
        <div className="hub-pick-board-kicker">
          <strong>{board.snake ? "Snake board" : "Linear board"}</strong>
          <span className="chart-note">{summary}</span>
        </div>
        <div className="hub-pick-board-controls">
          <button type="button" className="btn-ghost btn-sm" onClick={goCurrent}>
            Current pick
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={focusRound <= 1}
            onClick={() => setFocusRound((r) => Math.max(1, r - 1))}
          >
            Previous round
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={focusRound >= board.totalRounds}
            onClick={() => setFocusRound((r) => Math.min(board.totalRounds, r + 1))}
          >
            Next round
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            aria-pressed={fullBoard}
            onClick={() => setFullBoard((v) => !v)}
          >
            {fullBoard ? "Compact" : "Full board"}
          </button>
        </div>
      </header>

      <div className="hub-pick-board-scroll" ref={scrollerRef}>
        <div
          className="hub-pick-board-grid"
          style={{ "--pick-cols": String(Math.max(1, board.teamCount)) }}
        >
          <div className="hub-pick-board-corner" aria-hidden>Rd</div>
          {board.columns.map((col) => (
            <div
              key={col.teamId || col.columnIndex}
              className={`hub-pick-board-head${col.isViewer ? " is-viewer" : ""}`}
              title={col.teamName}
            >
              {col.abbrev}
            </div>
          ))}
          {visibleRows.map((row) => (
            <React.Fragment key={row.round}>
              <div
                className={`hub-pick-board-round${row.reverses ? " is-reverse" : ""}`}
                title={row.reverses ? "Snake reverse — last team picks first" : undefined}
              >
                {row.round}
                {row.reverses ? <span className="hub-pick-board-rev" aria-label="snake reverse">↩</span> : null}
              </div>
              {row.cells.map((cell) => {
                const media = mediaByPlayerId?.[cell.pick?.player_id] || {};
                const nfl = cell.pick?.nfl_team || "";
                const classes = [
                  "hub-pick-board-cell",
                  cell.filled ? "is-filled" : "is-empty",
                  cell.isActive ? "is-active" : "",
                  cell.isViewer ? "is-viewer" : "",
                  cell.isSnakeTurn ? "is-turn" : "",
                ].filter(Boolean).join(" ");
                return (
                  <div
                    key={`${cell.round}-${cell.columnIndex}`}
                    className={classes}
                    ref={cell.isActive ? activeRef : undefined}
                    aria-current={cell.isActive ? "step" : undefined}
                    title={cell.filled
                      ? `${cell.label} · ${cell.pick.player_name} (${cell.pick.position}) · ${cell.teamName}`
                      : `${cell.label} · ${cell.teamName}`}
                  >
                    <span className="hub-pick-board-pickno">{cell.label}</span>
                    {cell.isActive ? (
                      <>
                        <strong className="hub-pick-board-name">On the clock</strong>
                        <span className="hub-pick-board-meta">{cell.teamAbbrev}</span>
                      </>
                    ) : cell.filled ? (
                      <>
                        <span className="hub-pick-board-player">
                          {media.headshot_url ? (
                            <img className="hub-pick-board-shot" src={media.headshot_url} alt="" />
                          ) : (
                            <CellMark nflTeam={nfl} playerName={cell.pick.player_name} />
                          )}
                          <strong className="hub-pick-board-name">{cell.pick.player_name}</strong>
                        </span>
                        <span className="hub-pick-board-meta">
                          {cell.pick.position || "?"}
                          {" · "}
                          {nfl || "FA"}
                          {" · "}
                          {cell.teamAbbrev}
                        </span>
                      </>
                    ) : (
                      <span className="hub-pick-board-meta">{cell.teamAbbrev}</span>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      {!fullBoard && (
        <p className="chart-note hub-pick-board-footnote">
          Showing round {focusRound} of {board.totalRounds}. Open full board to inspect every slot.
          {next && !next.isCurrent ? ` Next for you: ${next.label} (${next.picksAway} away).` : ""}
        </p>
      )}
    </section>
  );
}

export { formatPickLabel };
