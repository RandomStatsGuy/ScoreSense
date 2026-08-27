import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { teamLogoUrl, playerInitials, lookupPlayerMedia, headshotCandidates } from "./draftMedia";
import {
  buildDraftBoard,
  formatPickLabel,
  isPickDraftType,
  visibleRoundWindow,
} from "./snakeDraftBoard";

function CellMark({ nflTeam, playerName }) {
  const src = teamLogoUrl(nflTeam);
  if (src) return <img className="hub-pick-board-mark" src={src} alt="" />;
  return <span className="hub-pick-board-initials" aria-hidden>{playerInitials(playerName)}</span>;
}

function BoardGrid({ board, rows, mediaByPlayerId, scrollerRef, activeRef, modal = false }) {
  return (
    <div className={`hub-pick-board-scroll${modal ? " hub-pick-board-scroll--modal" : ""}`} ref={scrollerRef}>
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
        {rows.map((row) => (
          <React.Fragment key={row.round}>
            <div
              className={`hub-pick-board-round${row.reverses ? " is-reverse" : ""}`}
              title={row.reverses ? "Snake reverse — last team picks first" : undefined}
            >
              {row.round}
              {row.reverses ? <span className="hub-pick-board-rev" aria-label="snake reverse">↩</span> : null}
            </div>
            {row.cells.map((cell) => {
              const media = lookupPlayerMedia(mediaByPlayerId, cell.pick?.player_id) || {};
              const nfl = cell.pick?.nfl_team || "";
              const shot = headshotCandidates(media)[0];
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
                        {shot ? (
                          <img className="hub-pick-board-shot" src={shot} alt="" />
                        ) : (
                          <CellMark nflTeam={nfl} playerName={cell.pick.player_name} />
                        )}
                        <strong className="hub-pick-board-name">{cell.pick.player_name}</strong>
                      </span>
                      <span className="hub-pick-board-meta">
                        {cell.pick.position || "?"} · {nfl || "FA"} · {cell.teamAbbrev}
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
  );
}

export default function SnakeDraftBoard({
  id,
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
  const [fullBoard, setFullBoard] = useState(false);
  const compactScrollerRef = useRef(null);
  const compactActiveRef = useRef(null);
  const modalScrollerRef = useRef(null);
  const modalActiveRef = useRef(null);
  const inlineFullBoard = variant === "recap" && !compactDefault;

  useEffect(() => setFocusRound(board.currentRound || 1), [board.currentRound]);

  useEffect(() => {
    const node = fullBoard ? modalActiveRef.current : compactActiveRef.current;
    const scroller = fullBoard ? modalScrollerRef.current : compactScrollerRef.current;
    if (!node || !scroller) return undefined;
    const frame = window.requestAnimationFrame(() => {
      node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [board.currentOverall, board.currentRound, fullBoard, focusRound]);

  useEffect(() => {
    if (!fullBoard || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setFullBoard(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [fullBoard]);

  const visibleRows = useMemo(
    () => (inlineFullBoard ? board.rows : visibleRoundWindow(board.rows, focusRound, 3)),
    [board.rows, focusRound, inlineFullBoard],
  );

  if (!enabled) return null;

  const next = board.nextPick;
  const summary = next
    ? (next.isCurrent
      ? "You're on the clock"
      : `Your next pick: ${next.label} · ${next.picksAway} pick${next.picksAway === 1 ? "" : "s"} away`)
    : `${board.totalRounds} rounds · ${board.teamCount} teams`;
  const firstVisible = visibleRows[0]?.round || 1;
  const lastVisible = visibleRows[visibleRows.length - 1]?.round || firstVisible;

  const goCurrent = () => {
    setFocusRound(board.currentRound || 1);
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const node = fullBoard ? modalActiveRef.current : compactActiveRef.current;
      node?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  };

  const toolbar = (
    <header className="hub-pick-board-toolbar">
      <div className="hub-pick-board-kicker">
        <span className="hub-draft-experience-kicker">Draft state</span>
        <strong>{board.snake ? "Snake draft board" : "Linear draft board"}</strong>
        <span className="chart-note">{summary}</span>
      </div>
      <div className="hub-pick-board-controls">
        <button type="button" className="btn-ghost btn-sm" onClick={goCurrent}>Current</button>
        {!inlineFullBoard && (
          <>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={focusRound <= 1}
              onClick={() => setFocusRound((round) => Math.max(1, round - 1))}
              aria-label="Previous round"
            >
              ← Round
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={focusRound >= board.totalRounds}
              onClick={() => setFocusRound((round) => Math.min(board.totalRounds, round + 1))}
              aria-label="Next round"
            >
              Round →
            </button>
          </>
        )}
        <button type="button" className="btn-primary btn-sm" onClick={() => setFullBoard(true)}>
          Full board
        </button>
      </div>
    </header>
  );

  const modal = fullBoard && typeof document !== "undefined" ? createPortal(
    <div className="hub-pick-board-modal-backdrop" role="presentation" onMouseDown={() => setFullBoard(false)}>
      <section
        className="hub-pick-board-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Full ${board.snake ? "snake" : "linear"} draft board`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="hub-pick-board-modal-head">
          <div>
            <span className="hub-draft-experience-kicker">Every pick</span>
            <h2>{board.snake ? "Full snake board" : "Full linear board"}</h2>
            <p>{summary}</p>
          </div>
          <div className="hub-pick-board-modal-actions">
            <button type="button" className="btn-ghost btn-sm" onClick={goCurrent}>Current pick</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setFullBoard(false)}>Close</button>
          </div>
        </header>
        <BoardGrid
          board={board}
          rows={board.rows}
          mediaByPlayerId={mediaByPlayerId}
          scrollerRef={modalScrollerRef}
          activeRef={modalActiveRef}
          modal
        />
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <section
        id={id}
        className={`hub-pick-board${variant === "recap" ? " hub-pick-board--recap" : " hub-pick-board--stage"}`}
        aria-label={`${board.snake ? "Snake" : "Linear"} draft board`}
        tabIndex={variant === "recap" ? -1 : undefined}
      >
        {toolbar}
        <BoardGrid
          board={board}
          rows={visibleRows}
          mediaByPlayerId={mediaByPlayerId}
          scrollerRef={compactScrollerRef}
          activeRef={compactActiveRef}
        />
        {!inlineFullBoard && (
          <p className="chart-note hub-pick-board-footnote">
            Rounds {firstVisible}–{lastVisible} of {board.totalRounds}
            {next && !next.isCurrent ? ` · Next for you: ${next.label} (${next.picksAway} away)` : ""}
          </p>
        )}
      </section>
      {modal}
    </>
  );
}

export { formatPickLabel };
