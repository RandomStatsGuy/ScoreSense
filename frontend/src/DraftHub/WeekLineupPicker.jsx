import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtNum } from "../format";
import { RowFace } from "./WeekLineupBoard";
import {
  eligibleLineupReplacements, formatKickoffFact, LINEUP_PICKER_COPY as COPY,
  lineupPlayerLocked, lineupReplacementDelta, slatePlayerMeta, sleeperLineupUrl, WEEK_BOARD_COPY,
} from "./weekBoard";
import "../styles/lineup-picker.css";

const pts = (player) => player?.p50 == null ? "—" : fmtNum(player.p50, 1);

function MovePlayer({ player, label, media }) {
  return <div className="lineup-picker-move-player">
    <span className="lineup-picker-role">{label}</span>
    <RowFace player={player} media={media} />
    <strong>{player?.player_name || player?.player_id || WEEK_BOARD_COPY.emptySlotName}</strong>
    <span>{pts(player)} {WEEK_BOARD_COPY.ptsUnit}</span>
  </div>;
}

export default function WeekLineupPicker({ slot, bench, rules, media, canEdit, lineupLocked,
  staffOverride = false, sleeperLeagueId, busy, error, onClose, onApply, onNavigate }) {
  const [selectedId, setSelectedId] = useState("");
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const candidates = eligibleLineupReplacements(slot, bench, rules);
  const selected = candidates.find((p) => String(p.player_id) === selectedId);
  const delta = selected ? lineupReplacementDelta(slot, selected) : null;
  const starterLocked = lineupPlayerLocked(slot.player, { staffOverride });
  const locked = (lineupLocked && !canEdit) || starterLocked;
  const href = sleeperLineupUrl(sleeperLeagueId);
  const applyAllowed = canEdit && !locked && selected && !lineupPlayerLocked(selected, { staffOverride });

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

  return createPortal(<div className="lineup-picker-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section ref={dialogRef} className="lineup-picker" role="dialog" aria-modal="true"
      aria-labelledby="lineup-picker-title" onKeyDown={onKeyDown} aria-busy={busy}>
      <header className="lineup-picker-head">
        <div><p className="lineup-picker-role">{slot.slot} · {COPY.lineup}</p><h2 id="lineup-picker-title">{COPY.title(slot.slot)}</h2></div>
        <button ref={closeRef} type="button" className="btn-ghost lineup-picker-close" aria-label={COPY.close}
          disabled={busy} onClick={onClose}>×</button>
      </header>
      <div className="lineup-picker-body">
        {slot.player && <div className="lineup-picker-current"><RowFace player={slot.player} media={media} />
          <div><span className="lineup-picker-role">{COPY.current}</span><strong>{slot.player.player_name || slot.player.player_id}</strong>
            <span>{slatePlayerMeta(slot.player)}</span></div><b>{pts(slot.player)}</b></div>}
        <p className="lineup-picker-hint">{COPY.choose}</p>
        <div className="lineup-picker-options" role="radiogroup" aria-label={COPY.choose}
          onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const options = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
            if (!options.length) return;
            event.preventDefault();
            const index = options.indexOf(document.activeElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
              : (index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) + options.length) % options.length;
            options[next].click(); options[next].focus();
          }}>
          {candidates.map((player) => {
            const playerLocked = lineupPlayerLocked(player, { staffOverride });
            const picked = selectedId === String(player.player_id);
            const change = lineupReplacementDelta(slot, player);
            return <button type="button" role="radio" aria-checked={picked}
              aria-label={`${player.player_name || player.player_id}${playerLocked ? `, ${COPY.locked}` : ""}`}
              className={`lineup-picker-option${picked ? " is-selected" : ""}`} key={player.player_id}
              disabled={busy || locked || playerLocked} onClick={() => setSelectedId(String(player.player_id))}>
              <RowFace player={player} media={media} /><span className="lineup-picker-identity">
                <strong>{player.player_name || player.player_id}</strong><span>{slatePlayerMeta(player)}</span>
                <span>{playerLocked ? COPY.locked : formatKickoffFact(player)}</span>
                {change != null && <span className={change >= 0 ? "is-positive" : "is-negative"}>
                  {change > 0 ? "+" : ""}{fmtNum(change, 1)} pts</span>}
              </span><span className="lineup-picker-points">{pts(player)}<small>proj pts</small></span>
              <span className="lineup-picker-radio" aria-hidden="true">{picked ? "✓" : ""}</span>
            </button>;
          })}
        </div>
        {!candidates.length && <div className="lineup-picker-empty"><p>{COPY.empty}</p>
          {onNavigate && <button type="button" className="btn-ghost" onClick={() => {
            onClose(); onNavigate("available", { pos: slot.position || slot.slot });
          }}>{COPY.find(slot.position || slot.slot)}</button>}</div>}
        {selected ? <><div className="lineup-picker-preview">
          <MovePlayer player={slot.player} label={slot.player ? COPY.toBench : COPY.emptySlot} media={media} />
          <span aria-hidden="true">⇄</span><MovePlayer player={selected} label={COPY.toSlot(slot.slot)} media={media} />
        </div><p className={`lineup-picker-delta${delta != null && delta < 0 ? " is-negative" : ""}`} role="status">
          {delta == null ? COPY.missing : <><strong>{delta > 0 ? "+" : ""}{fmtNum(delta, 1)}</strong> {COPY.delta}</>}
        </p></> : <p className="lineup-picker-hint" role="status">{COPY.select}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer className="lineup-picker-footer">
        <p>{locked ? (starterLocked ? COPY.locked : COPY.lineupLocked) : href && !canEdit ? COPY.linked : !canEdit ? COPY.readonly : COPY.lockNote}</p>
        <div><button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>{COPY.cancel}</button>
          {href && !canEdit && !locked ? <a href={href} target="_blank" rel="noreferrer" className="btn-primary">{COPY.openSleeper}</a>
            : <button type="button" className="btn-primary" disabled={!applyAllowed || busy} onClick={() => onApply(slot, selected)}>
              {busy ? COPY.saving : selected ? COPY.start(selected.player_name || selected.player_id, slot.slot) : COPY.select}
            </button>}
        </div>
      </footer>
    </section>
  </div>, document.body);
}
