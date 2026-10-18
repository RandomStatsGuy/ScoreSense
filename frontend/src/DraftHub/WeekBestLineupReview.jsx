import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../format";
import { RowFace } from "./WeekLineupBoard";
import { LINEUP_PICKER_COPY, WEEK_BOARD_COPY as COPY } from "./weekBoard";
import "../styles/lineup-picker.css";

/** Reviews every suggested bench swap before one save; the same lineup-picker shell as a single move. */
export default function WeekBestLineupReview({ moves = [], total = null, players = new Map(), media, busy = false, error = "", onClose, onApply }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus?.();
    };
  }, []);
  const onKeyDown = (event) => {
    if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const focusable = [...dialogRef.current.querySelectorAll("button:not(:disabled), a[href], [tabindex='0']")];
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
      event.preventDefault(); first?.focus();
    }
  };
  return createPortal(<div className="lineup-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="lineup-picker lineup-picker--best" role="dialog" aria-modal="true" aria-labelledby="lineup-best-title" onKeyDown={onKeyDown} aria-busy={busy}>
      <header className="lineup-picker-head">
        <div><p className="lineup-picker-role">{LINEUP_PICKER_COPY.lineup}</p><h2 id="lineup-best-title">{COPY.bestLineupTitle}</h2></div>
        <button ref={closeRef} type="button" className="btn-ghost lineup-picker-close" aria-label={COPY.bestLineupClose} disabled={busy} onClick={onClose}>×</button>
      </header>
      <div className="lineup-picker-body">
        <p className="lineup-picker-hint">{COPY.bestLineupBody(moves.length)}</p>
        <ul className="lineup-best-moves">
          {moves.map((move) => <li key={`${move.starter_player_id}-${move.bench_player_id}`} className="lineup-best-move">
            <span className="lineup-picker-role">{move.slot}</span>
            <RowFace player={players.get(String(move.bench_player_id))} slot={move.slot} media={media} />
            <span className="lineup-picker-identity"><strong>{move.bench_name}</strong><span>{LINEUP_PICKER_COPY.toBench}: {move.starter_name}</span></span>
            <span className={`lineup-picker-points${move.delta != null && move.delta < 0 ? " is-negative" : " is-positive"}`}>{move.delta == null ? "—" : `${move.delta > 0 ? "+" : ""}${fmtNum(move.delta, 1)}`}<small>{COPY.ptsUnit}</small></span>
          </li>)}
        </ul>
        <p className="lineup-picker-delta" role="status">{total == null ? COPY.bestLineupTotal(NaN) : <><strong>+{fmtNum(total, 1)}</strong> {LINEUP_PICKER_COPY.delta}</>}</p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer className="lineup-picker-footer">
        <p>{LINEUP_PICKER_COPY.lockNote}</p>
        <div><button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>{LINEUP_PICKER_COPY.cancel}</button>
          <button type="button" className="btn-primary" disabled={busy || !moves.length} onClick={() => onApply(moves)}>{busy ? LINEUP_PICKER_COPY.saving : COPY.startThese(moves.length)}</button></div>
      </footer>
    </section>
  </div>, document.body);
}
