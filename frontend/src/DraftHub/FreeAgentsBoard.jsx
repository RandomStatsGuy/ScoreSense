import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HubFilterMenu, HubPage } from "./HubUILayout";
import HubMediaImg from "./HubMediaImg";
import { headshotCandidates, playerInitials } from "./draftMedia";
import { nflTeamColors } from "./nflTeamColors";
import useModalFocus from "../ui/useModalFocus";
import { resolveSeasonBand, seasonRangeTooltip } from "../seasonQuantiles";
import { effectiveAuctionBid } from "../riskAdjustedValue";
import { suggestedBidSubLabel } from "./suggestedBidLabel";
import { scoringLabel } from "./strategyRank";
import { parseWalkaway, bidBlockedByCeiling } from "./faWalkaway";
import { FA_BID_COPY, faWalkawayAbove } from "./faBidPresentation";
import { CLAIM_QUEUE_COPY, FACEOFF_COPY as FO, PLAYERS_TAB_COPY as COPY, playersTabAddLabel, playersTabBusyLabel } from "./acquisitionWindow";
import { faceoffRangeMarks, faceoffSurname, isSpecialistSlot } from "./freeAgentFaceoff";
import "./FreeAgentsBoard.css";

const pts = (n, digits = 0) => n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(digits);
export const FREE_AGENT_ROW_HEIGHT = 100;
const motionOk = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

function Icon({ search = false }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {search ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></> : <><circle cx="12" cy="12" r="9" /><path d="M12 10v7M12 7v1" /></>}
  </svg>;
}

/** Headshot tile with a matte team tint mixed into the surface. */
function Face({ row, media }) {
  const id = row.player_id;
  const src = headshotCandidates(media?.[id], [], { width: 96 })[0];
  const name = row.player || row.name || row.player_name;
  return <span className="fa-face" aria-hidden="true" style={row.team ? { "--team": nflTeamColors(row.team).plate } : undefined}><span>{playerInitials(name)}</span><HubMediaImg src={src} width={96} /></span>;
}

/** Numbers count to their new value; reduced motion snaps. */
function Count({ value, decimals = 1, signed = false }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current, to = value;
    fromRef.current = value;
    if (to == null || from == null || !motionOk() || from === to) { setShown(to); return undefined; }
    const start = performance.now(), ms = 560;
    let frame = 0;
    const step = now => {
      const t = Math.min(1, (now - start) / ms), ease = 1 - (1 - t) ** 3;
      setShown(from + (to - from) * ease);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  if (shown == null) return "—";
  const text = Math.abs(shown).toFixed(decimals);
  return signed ? `${shown > 0.0001 ? "+" : shown < -0.0001 ? "−" : ""}${text}` : text;
}

function Range({ band, scale, marks }) {
  if (![band.p10, band.p50, band.p90].every(n => n != null && Number.isFinite(n))) return null;
  const pct = n => `${Math.max(0, Math.min(100, n / scale * 100))}%`;
  const style = { "--low": pct(band.p10), "--median": pct(band.p50), "--high": pct(band.p90) };
  if (marks) { style["--tick"] = `${marks.tick}%`; if (marks.beat != null) style["--beat"] = `${marks.beat}%`; }
  return <div className={`fa-range-track${marks ? " has-tick" : ""}`} aria-hidden="true" style={style}>{marks?.beat != null && <i className="fa-beat" />}{marks && <i className="fa-tick" />}</div>;
}

const landsLabel = mode => mode === "bid" ? FO.afterLabel : mode === "claim" ? FO.afterLabelClaim : FO.afterLabelAdd;
const landsAll = mode => mode === "bid" ? FO.afterAllBid : mode === "claim" ? FO.afterAllClaim : FO.afterLabelAdd;
const slotName = slot => slot?.slot || "";

/** The scoreboard: your lineup per game, what pending moves do to it, and the best upgrade left. */
function Scoreboard({ faceoff, mode }) {
  const { total, pending, targetSlot, best, beats, hasStarters } = faceoff;
  let now = total.total, from = null, delta = null, label = FO.labelNone, verdict = FO.verdictSet, up = false;
  if (!hasStarters) {
    verdict = FO.verdictNoRoster; now = null;
  } else if (pending.swaps.size && !targetSlot?.bench) {
    const swaps = [...pending.swaps.values()];
    verdict = swaps.length === 1
      ? FO.verdictPending(faceoffSurname(swaps[0].row.player || swaps[0].row.player_name), swaps[0].slot, swaps[0].from ? faceoffSurname(swaps[0].from.name) : "")
      : FO.verdictPendingMany(swaps.length, pending.delta ?? 0);
    now = pending.after ?? total.total; from = pending.after != null ? pending.before : null; delta = pending.delta; label = landsAll(mode); up = (delta ?? 0) >= 1;
  } else if (targetSlot) {
    const n = beats.get(targetSlot.key) ?? 0, surname = targetSlot.player ? faceoffSurname(targetSlot.player.name) : "";
    if (!targetSlot.player) verdict = FO.verdictOpen(n, slotName(targetSlot));
    else if (targetSlot.player.pg == null) verdict = FO.verdictPlayerMissing;
    else verdict = n ? `${FO.verdictTarget(n, surname, targetSlot.player.pg)}${best ? ` ${FO.verdictGains(faceoffSurname(best.row.player))}` : ""}` : FO.verdictTargetNone(surname, targetSlot.player.pg);
    delta = best?.delta ?? 0; label = FO.labelBestAt(slotName(targetSlot)); up = best != null && best.delta >= 1;
    if (targetSlot.bench) { now = targetSlot.player.pg; label = FO.benchBest(targetSlot.player.position); }
    if (targetSlot.player && targetSlot.player.pg == null) delta = null;
  } else if (best) {
    verdict = best.against.player ? FO.verdictBest(best.row.player, best.delta, slotName(best.against), faceoffSurname(best.against.player.name)) : FO.verdictBestEmpty(best.row.player, best.delta, slotName(best.against));
    delta = best.delta; label = FO.labelBest; up = best.delta >= 1;
  } else if (total.total == null && total.missing) verdict = FO.verdictMissing;
  return <section className={`fa-board${up ? " is-up" : ""}`} aria-label={FO.board}>
    <div className="fa-board-now"><small>{targetSlot?.bench ? FO.comparing(faceoffSurname(targetSlot.player.name)) : FO.board}</small><strong><Count value={now} /><span className="fa-unit"> {COPY.perGame}</span></strong>{from != null && <small className="fa-board-from">{FO.was(from)}</small>}</div>
    <div className="fa-board-delta"><strong><Count value={delta} signed /></strong><small>{label}</small></div>
    <p className="fa-board-verdict">{verdict}</p>
  </section>;
}

function pendingLabelFor(swap, mode) { return FO.pendingIn(faceoffSurname(swap.row.player || swap.row.player_name), landsLabel(mode)); }

/** Desktop column: every starter is a spot you can shop for; amber dots mark the softest. */
function RosterColumn({ faceoff, mode, onTarget, busy }) {
  const { lineup, benchSlots, target, pending, beats, weakKeys, total, targetSlot } = faceoff;
  const row = slot => {
    const swap = pending.swaps.get(slot.key), n = beats.get(slot.key) ?? 0, p = slot.player;
    const cls = `fa-roster-row${slot.bench ? " is-bench" : ""}${weakKeys.has(slot.key) && p ? " is-weak" : ""}${swap ? " is-swapping" : ""}${!p ? " is-open" : ""}`;
    const inner = <><small>{slotName(slot)}</small><span className="fa-roster-name"><strong>{p ? p.name : FO.openSpot}</strong><span>{swap ? <em>{pendingLabelFor(swap, mode)}</em> : p ? <>{[p.position, p.team].filter(Boolean).join(" · ")}{n > 0 && <> · <em>{FO.beatCount(n)}</em></>}</> : FO.beatSlotCount(n, slotName(slot))}</span></span><b>{swap ? <><s>{pts(p?.pg, 1)}</s> {pts(swap.row.per_game_proj, 1)}</> : pts(p?.pg, 1)}</b></>;
    const label = p ? `${slotName(slot)}: ${p.name}, ${pts(p.pg, 1)} ${FO.perGameUnit}${n ? `, ${FO.beatCount(n)}` : ""}` : `${slotName(slot)}: ${FO.openSpot}`;
    return <button type="button" key={slot.key} className={cls} aria-pressed={target === slot.key} aria-label={label} disabled={busy} onClick={() => onTarget(target === slot.key ? null : slot.key)}>{inner}</button>;
  };
  return <aside className="fa-roster" aria-label={FO.rosterLabel}>
    <div className="fa-roster-head"><h2>{FO.rosterTitle}</h2>{target ? <button type="button" className="fa-link" onClick={() => onTarget(null)}>{FO.clearTarget}</button> : <span>{pts(total.total, 1)} {FO.perGameUnit}</span>}</div>
    <p className="fa-roster-shopping">{targetSlot ? (targetSlot.player ? FO.shoppingFor(slotName(targetSlot), faceoffSurname(targetSlot.player.name)) : FO.shoppingOpen(slotName(targetSlot))) : target === "open" ? FO.shoppingBench : FO.tapSpot}</p>
    <div className="fa-roster-list">
      {lineup.starters.map(row)}
      {lineup.bench.length > 0 && <p className="fa-roster-divider">{FO.bench}</p>}
      {benchSlots.map(row)}
      {lineup.openSpots > 0 && <button type="button" className="fa-roster-row is-open" aria-pressed={target === "open"} disabled={busy} onClick={() => onTarget(target === "open" ? null : "open")}><small>BN</small><span className="fa-roster-name"><strong>{FO.openSpots(lineup.openSpots)}</strong><span>{FO.rosterSpotOpen}</span></span><b>—</b></button>}
    </div>
  </aside>;
}

/** Phone rail: the same spots as swipeable tiles. */
function SpotRail({ faceoff, mode, onTarget, busy }) {
  const { lineup, benchSlots, target, pending, beats, weakKeys } = faceoff;
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector("[aria-pressed=true]")?.scrollIntoView({ inline: "center", block: "nearest" }); }, [target]);
  return <div className="fa-rail-tiles" ref={ref} role="group" aria-label={FO.spotsLabel}>
    {[...lineup.starters.filter(slot => !isSpecialistSlot(slot)), ...benchSlots].map(slot => {
      const swap = pending.swaps.get(slot.key), n = beats.get(slot.key) ?? 0, p = slot.player;
      return <button type="button" key={slot.key} className={`fa-tile${weakKeys.has(slot.key) && p ? " is-weak" : ""}${swap ? " is-swapping" : ""}${!p ? " is-open" : ""}`} aria-pressed={target === slot.key} disabled={busy}
        aria-label={p ? `${slotName(slot)}: ${p.name}, ${pts(p.pg, 1)} ${FO.perGameUnit}${n ? `, ${FO.beatCount(n)}` : ""}` : `${slotName(slot)}: ${FO.openSpot}`} onClick={() => onTarget(target === slot.key ? null : slot.key)}>
        <small>{slotName(slot)}</small><strong>{swap ? faceoffSurname(swap.row.player || swap.row.player_name) : p ? faceoffSurname(p.name) : FO.openSpot}</strong>
        <b>{swap ? <><s>{pts(p?.pg, 1)}</s> {pts(swap.row.per_game_proj, 1)}</> : p ? `${pts(p.pg, 1)} / g` : FO.rosterSpotOpen}{n > 0 && !swap && p && <em> · {FO.beatShort(n)}</em>}</b>
      </button>;
    })}
    {lineup.openSpots > 0 && <button type="button" className="fa-tile is-open" aria-pressed={target === "open"} disabled={busy} onClick={() => onTarget(target === "open" ? null : "open")}><small>BN</small><strong>{FO.openSpot}</strong><b>{FO.rosterSpotOpen}</b></button>}
    {target && <button type="button" className="fa-tile" onClick={() => onTarget(null)}><small>{FO.poolShort}</small><strong>{FO.allSpots}</strong><b>{FO.clearShort}</b></button>}
  </div>;
}

/** The duel inside the sheet: incoming beside the starter he pushes out, the change in the middle. */
function Duel({ row, media, scale, faceoff, mode }) {
  const { against, delta } = faceoff.compare(row);
  if (!against) return null;
  const band = resolveSeasonBand(row), out = against.player, pg = row.per_game_proj;
  const up = delta != null && delta >= 1;
  const head = pg == null || (out && out.pg == null) ? FO.duelUnavailable : !out ? FO.duelHeadEmpty(faceoffSurname(row.player), slotName(against)) : against.bench ? FO.duelBench(faceoffSurname(row.player), faceoffSurname(out.name), delta) : FO.duelHead(faceoffSurname(row.player), delta, faceoffSurname(out.name), slotName(against));
  const now = faceoff.total.total, after = !against.bench && now != null && delta != null && delta > 0 ? now + delta : null;
  const marks = faceoffRangeMarks(band, against, scale);
  return <div className={`fa-versus${up ? " is-up" : ""}`}>
    <div className="fa-duel">
      <div className="fa-duel-side"><Face row={row} media={media} /><strong>{faceoffSurname(row.player)}</strong><span>{[row.position, row.team].filter(Boolean).join(" · ")}</span><b>{pts(pg, 1)}</b><span>{COPY.perGame}</span></div>
      <div className="fa-duel-center"><strong>{delta == null ? "—" : FO.delta(delta)}</strong><span>{FO.perGameUnit} · {slotName(against)}</span></div>
      <div className="fa-duel-side is-out">{out ? <><Face row={{ player_id: out.player_id, player: out.name, team: out.team }} media={media} /><strong>{faceoffSurname(out.name)}</strong><span>{[out.position, out.team, slotName(against)].filter(Boolean).join(" · ")}</span><b>{pts(out.pg, 1)}</b><span>{COPY.perGame}</span></> : <><span className="fa-face is-empty" aria-hidden="true"><span>{slotName(against)}</span></span><strong>{FO.openSpot}</strong><span>{slotName(against)}</span><b>—</b></>}</div>
    </div>
    <p className="fa-duel-head">{head}</p>
    <Range band={band} scale={scale} marks={marks} />
    {marks?.season != null && out && <p className="fa-versus-note">{FO.duelNote(faceoffSurname(row.player), faceoffSurname(out.name))} <i className="fa-tick-key">{FO.tickKey(faceoffSurname(out.name), marks.season)}</i></p>}
    {after != null && <p className="fa-versus-lineup">{FO.lineupAfter(now, after, landsLabel(mode))}</p>}
  </div>;
}

function ActionSheet({ draft, media, scale, mode, canAct, busy, error, onClose, onChange, onConfirm,
  remainingCap, pickDraft, rules, riskTolerance, roster, priority, onHistory, onWatch, watched, reason, faceoff }) {
  const ref = useRef(null);
  const [drop, setDrop] = useState(() => mode === "claim" ? String(faceoff?.targetSlot?.player?.player_id || "") : "");
  useModalFocus(true, ref, () => { if (!busy) onClose(); });
  const row = draft.row, band = resolveSeasonBand(row);
  const bid = parseWalkaway(draft.amount), ceiling = parseWalkaway(draft.ceiling);
  const aboveCeiling = bidBlockedByCeiling(bid, ceiling);
  const aboveCap = !pickDraft && remainingCap != null && bid != null && bid > Number(remainingCap);
  const instantOverCap = mode === "add" && !pickDraft && remainingCap != null && Number(remainingCap) < 1;
  const blocked = !canAct || busy || instantOverCap || (mode === "bid" && (bid == null || ceiling == null || aboveCeiling || aboveCap));
  const suggested = effectiveAuctionBid(row, riskTolerance, rules);
  const pricing = suggestedBidSubLabel({ scoringProfile: rules?.scoring_profile || rules?.scoring, riskTolerance });
  const open = faceoff?.lineup.openSpots;
  const dropPlayer = mode === "claim" && drop ? roster.find(p => String(p.player_id) === drop) : null;
  const spotNote = dropPlayer ? FO.rosterSpotDrop(dropPlayer.player_name || dropPlayer.player || drop) : !faceoff || mode === "locked" ? null : open == null ? null : open > 0 ? FO.rosterSpotOpenCount(open) : mode === "claim" ? FO.rosterSpotHint : mode === "bid" ? FO.rosterSpotFullBid : FO.rosterSpotFullAdd;
  return createPortal(<div className="fa-sheet-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="fa-sheet-name" tabIndex={-1} className="fa-sheet">
      <header className="fa-dialog-head"><h2>{COPY.playerDetails}</h2><button className="fa-icon" aria-label={COPY.close} onClick={onClose} disabled={busy}>×</button></header>
      <div className="fa-dialog-content">
        <div className="fa-dialog-identity"><Face row={row} media={media} /><div><h3 id="fa-sheet-name">{row.player}</h3><p>{[row.position, row.team].filter(Boolean).join(" · ")}{row.per_game_proj != null && ` · ${pts(row.per_game_proj, 1)} ${COPY.perGame}`}</p></div></div>
        {faceoff && mode !== "locked" && <Duel row={row} media={media} scale={scale} faceoff={faceoff} mode={mode} />}
        <div className="fa-detail-chart">
          <dl className="fa-detail-stats">{[[COPY.floor, band.p10], [COPY.seasonShort, band.p50], [COPY.ceiling, band.p90]].map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{pts(n)}</dd></div>)}</dl>
          <Range band={band} scale={scale} />
          <p className="fa-muted">{row.per_game_proj != null ? `${pts(row.per_game_proj, 1)} ${COPY.perGame} · ` : ""}{scoringLabel(rules?.scoring_profile || rules?.scoring)}</p>
          <p className="fa-muted">{seasonRangeTooltip(band.method, { preliminary: band.preliminary })}</p>
        </div>
        {!pickDraft && suggested != null && <p><strong>{COPY.suggested(suggested)}</strong><span className="fa-support">{pricing}</span></p>}
        {mode === "bid" && <>
          <div className="fa-bid-fields"><label className="fa-field">{COPY.yourBid}<input type="number" min="1" step="1" inputMode="numeric" value={draft.amount} disabled={busy} onChange={e => onChange({ amount: e.target.value })} /></label>
            <label className="fa-field">{FA_BID_COPY.walkAway}<input type="number" min="1" step="1" inputMode="numeric" value={draft.ceiling} disabled={busy} onChange={e => onChange({ ceiling: e.target.value })} /></label></div>
          <p className="fa-muted">{COPY.ceilingHint}</p>
          {!pickDraft && remainingCap != null && bid != null && <p>{COPY.capAfter(Number(remainingCap) - bid)}</p>}
          {aboveCeiling && <p className="fa-warning" role="status">{COPY.aboveCeiling}</p>}
          {aboveCap && <p className="fa-warning" role="status">{COPY.aboveCap}</p>}
        </>}
        {spotNote && <div className="fa-spot-field"><span>{FO.rosterSpot}</span><p className="fa-muted">{spotNote}</p></div>}
        {mode === "claim" && <><p className="fa-muted">{priority}</p><HubFilterMenu className="hub-filter-menu--fluid hub-filter-menu--inline" label={CLAIM_QUEUE_COPY.dropLabel} value={drop} options={[{ id: "", label: CLAIM_QUEUE_COPY.noDrop }, ...roster.map(p => ({ id: String(p.player_id), label: p.player_name || p.player || String(p.player_id) }))]} disabled={busy || !canAct} onChange={setDrop} /></>}
        {mode === "add" && <p className="fa-muted">{pickDraft ? COPY.addEffect : COPY.addSalaryEffect(suggested)}</p>}
        {instantOverCap && <p className="fa-warning" role="status">{COPY.aboveCap}</p>}
        {reason && <p className="fa-warning">{reason}</p>}
        {!pickDraft && onHistory && <button className="fa-quiet-link" disabled={busy} onClick={() => { onClose(); onHistory({ playerId: row.player_id, playerName: row.player }); }}>{COPY.history}<span aria-hidden="true">↗</span></button>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer className="fa-dialog-footer">
        {mode === "locked" && onWatch && <button className="btn-ghost btn-sm" disabled={busy} aria-pressed={watched} onClick={() => onWatch(row)}>{watched ? COPY.starredShort : COPY.starShort}</button>}
        <button className="btn-primary fa-confirm" disabled={blocked} onClick={() => onConfirm(drop)}>{busy ? playersTabBusyLabel(mode) : mode === "bid" ? FA_BID_COPY.placeBid : mode === "claim" ? COPY.confirmClaim : COPY.addPlayer}</button>
      </footer>
    </section>
  </div>, document.body);
}

/** One line under the name: what this player does to your lineup. Amber only for a real upgrade. */
function edgeCopy(row, faceoff) {
  if (!faceoff || row.per_game_proj == null) return null;
  const { against, delta } = faceoff.compare(row);
  if (!against) return { cls: "", text: FO.edgeNoStarter };
  if (!against.player) return { cls: "is-open", text: FO.edgeEmpty(slotName(against)) };
  if (delta == null) return null;
  const surname = faceoffSurname(against.player.name);
  if (delta >= 1) return { cls: "is-up", text: FO.edgeOver(delta, surname, slotName(against)) };
  if (delta > 0) return { cls: "", text: `${FO.edgeNear(surname)} · ${slotName(against)}` };
  return { cls: "", text: FO.edgeDepth(surname) };
}

export default function FreeAgentsBoard({ rows, count, loading, media, scale, scrollerRef, topPad, bottomPad, loadMore,
  pickDraft, rules, riskTolerance, banner, acquisitionWindow, remainingCap, addMode, addVisible, addEnabled, actionsDisabled,
  claims, claimsReady = true, priority, protectedIds, roster, rosterIds, onWatch, watchIds, onHistory, claimContent, ceilingFor,
  posFilter, positionOptions, setPosFilter, sortKey, sortOptions, onSort, search, setSearch,
  tierFilter, tierOptions, setTierFilter, riskProfile, riskOptions, setRiskProfile, needsOnly, needPositions, setNeedsOnly,
  loadError, onRetryLoad, boardDirty, resetBoard, emptyMessage, draft, onOpen, onClose, onChange, onConfirm, busy, error,
  faceoff = null, onTarget, groupStarts = null, listKey = "", notice = null, justSavedId = null }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [fresh, setFresh] = useState(false);
  const lastKey = useRef(listKey);
  const noticeRef = useRef(null);
  useEffect(() => {
    if (lastKey.current === listKey) return undefined;
    lastKey.current = listKey;
    if (!motionOk()) return undefined;
    setFresh(true);
    const timer = setTimeout(() => setFresh(false), 700);
    return () => clearTimeout(timer);
  }, [listKey]);
  useEffect(() => { if (notice?.saved) noticeRef.current?.focus(); }, [notice]);
  const watched = id => watchIds.some(value => String(value) === String(id));
  const claimed = id => claims.some(c => String(c.player_id) === String(id));
  const pendingBid = id => Boolean(faceoff?.pendingIds?.has(String(id))) && addMode === "bid";
  const protectedPlayer = id => protectedIds.some(value => String(value) === String(id));
  const inRoster = id => rosterIds?.has(id) || rosterIds?.has(String(id));
  const reasonFor = row => addMode === "locked" ? (acquisitionWindow?.message || COPY.lockedReason) : protectedPlayer(row.player_id) ? CLAIM_QUEUE_COPY.protected : claimed(row.player_id) ? COPY.claimInQueue : pendingBid(row.player_id) ? FO.pendingBid : inRoster(row.player_id) ? COPY.onRoster : actionsDisabled || !addVisible ? COPY.readOnly : "";
  const canAct = row => addEnabled && !actionsDisabled && !protectedPlayer(row.player_id) && !claimed(row.player_id) && !inRoster(row.player_id);
  const pricing = pickDraft ? scoringLabel(rules?.scoring_profile || rules?.scoring) : suggestedBidSubLabel({ scoringProfile: rules?.scoring_profile || rules?.scoring, riskTolerance });
  const title = addMode === "locked" ? COPY.lockedReason : banner?.label || COPY.openAdds;
  const targetSlot = faceoff?.targetSlot || null;
  const targetSurname = targetSlot?.player ? faceoffSurname(targetSlot.player.name) : "";
  const pool = <>
    <div className="fa-toolbar"><HubFilterMenu className="hub-filter-menu--fluid" label={COPY.pos} value={posFilter} options={positionOptions} onChange={setPosFilter} />
      <HubFilterMenu className="hub-filter-menu--fluid" label={COPY.sort} value={sortKey} options={sortOptions.map(option => ({ ...option, shortLabel: COPY.sortShort[option.id] ?? (option.id === "fa_edge" ? option.label : undefined) }))} onChange={onSort} />
      <button className="fa-icon" aria-label={COPY.searchFilters} aria-expanded={filtersOpen} aria-controls="fa-filters" onClick={() => setFiltersOpen(v => !v)}><Icon search /></button></div>
    {filtersOpen && <div className="fa-filters" id="fa-filters"><input type="search" aria-label={COPY.search} placeholder={COPY.search} value={search} onChange={e => setSearch(e.target.value)} />
      {!pickDraft && <HubFilterMenu label={COPY.tier} value={tierFilter} options={tierOptions} onChange={setTierFilter} />}
      <HubFilterMenu label={COPY.risk} value={riskProfile} options={riskOptions} onChange={setRiskProfile} />
      {needPositions.length > 0 && <button className="btn-ghost btn-sm" aria-pressed={needsOnly} onClick={() => setNeedsOnly(v => !v)}>{COPY.needs(needPositions)}</button>}
      <button className="btn-ghost btn-sm" disabled={!boardDirty} onClick={resetBoard}>{COPY.reset}</button></div>}
    <div className="fa-list-label"><p aria-live="polite">{COPY.count(count)}{targetSlot && ` · ${FO.fitLabel(slotName(targetSlot))}`}{faceoff?.target === "open" && ` · ${FO.openSpot.toLowerCase()}`}</p><p>{COPY.seasonOutlook} · {pricing}</p></div>
    <details className="fa-range-guide"><summary>{COPY.rangeGuideTitle}</summary><p className="fa-muted">{COPY.rangeGuide}{faceoff ? ` ${FO.rangeGuideTick}` : ""}</p></details>
    {error && !draft && <p className="fa-info" role="status">{error}</p>}
    <div className={`fa-pool${fresh ? " is-fresh" : ""}`} ref={scrollerRef} aria-busy={loading}>
      {loading && count === 0 ? <div role="status" aria-label={COPY.loading}>{[0, 1, 2, 3, 4].map(n => <div className="fa-skeleton" key={n} />)}</div> : null}
      {loadError && <div className="fa-empty" role="alert"><p>{loadError}</p>{onRetryLoad && <button type="button" className="btn-ghost" onClick={onRetryLoad} disabled={loading}>{COPY.loadRetry}</button>}</div>}
      {!loading && !loadError && count === 0 && <div className="fa-empty"><p>{emptyMessage}</p>{boardDirty && <button className="btn-ghost btn-sm" onClick={resetBoard}>{COPY.reset}</button>}</div>}
      {topPad > 0 && <div aria-hidden="true" style={{ height: topPad }} />}
      {rows.map((row, i) => {
        const band = resolveSeasonBand(row), suggested = effectiveAuctionBid(row, riskTolerance, rules);
        const cmp = faceoff && addMode !== "locked" ? faceoff.compare(row) : null;
        const against = cmp?.against || null, delta = cmp?.delta ?? null;
        const edge = cmp && !targetSlot ? edgeCopy(row, faceoff) : null;
        const marks = against ? faceoffRangeMarks(band, against, scale) : null;
        const isBest = Boolean(faceoff?.best && String(faceoff.best.row.player_id) === String(row.player_id) && faceoff.best.delta >= 1);
        const group = groupStarts?.get(String(row.player_id));
        const pending = pendingBid(row.player_id);
        return <React.Fragment key={row.player_id}>
          {group && <p className={`fa-group${group.up ? " is-up" : ""}`}>{group.label}</p>}
          <article className={`fa-player${addMode === "locked" ? " is-locked" : ""}${justSavedId != null && String(justSavedId) === String(row.player_id) ? " is-just-saved" : ""}`} data-player-id={row.player_id} style={{ "--i": Math.min(i, 8) }}>
            <div className="fa-player-top"><button className="fa-profile" onClick={() => onOpen(row)} aria-label={COPY.openDetails(row.player)}><Face row={row} media={media} /><span className="fa-name"><strong>{row.player}{isBest && <span className="fa-tag">{FO.bestUpgrade}</span>}</strong><span>{[row.position, row.team].filter(Boolean).join(" · ")}</span>{row.per_game_proj != null && <span>{pts(row.per_game_proj, 1)} {COPY.perGame}</span>}{edge && <span className={`fa-edge ${edge.cls}`}>{edge.text}</span>}</span></button>
              {targetSlot && cmp ? <div className="fa-outlook"><strong className={delta != null && delta >= 1 ? "is-up" : undefined}>{delta == null ? "—" : FO.delta(delta)}</strong><small>{targetSlot.player ? `${FO.compareTo(targetSurname)} ${FO.perGameUnit}` : `${FO.compareToOpen(slotName(targetSlot))} ${FO.perGameUnit}`}</small></div>
                : <div className="fa-outlook"><strong>{pts(band.p50)}</strong><small>{COPY.seasonShort}</small></div>}</div>
            <div className="fa-player-bottom"><div className="fa-range" title={seasonRangeTooltip(band.method, { preliminary: band.preliminary })}><div className="fa-range-copy"><span>{pts(band.p10)}–{pts(band.p90)} {COPY.range}{marks?.season != null && against?.player && <> · <i className="fa-tick-key">{FO.tickKey(faceoffSurname(against.player.name), marks.season)}</i></>}</span>{!pickDraft && suggested != null && <strong className={addMode === "bid" && bidBlockedByCeiling(suggested, ceilingFor?.(row.player_id)) ? "fa-warning" : undefined} title={addMode === "bid" && bidBlockedByCeiling(suggested, ceilingFor?.(row.player_id)) ? faWalkawayAbove(ceilingFor(row.player_id)) : undefined}>{COPY.suggested(suggested)}</strong>}</div><Range band={band} scale={scale} marks={marks} /></div>
              {addMode === "locked" && onWatch && <button className="fa-icon" aria-label={`${watched(row.player_id) ? COPY.unstar : COPY.star}: ${row.player}`} aria-pressed={watched(row.player_id)} onClick={() => onWatch(row)}>{watched(row.player_id) ? "★" : "☆"}</button>}
              {addVisible && <button className={`fa-acquire${pending || claimed(row.player_id) ? " is-saved" : ""}`} disabled={!canAct(row) || busy} title={reasonFor(row)} aria-label={`${playersTabAddLabel(addMode)} ${row.player}`} onClick={() => onOpen(row)}>{claimed(row.player_id) ? CLAIM_QUEUE_COPY.claimed : pending ? FO.bidIn : playersTabAddLabel(addMode)}</button>}</div>
          </article>
        </React.Fragment>;
      })}
      {bottomPad > 0 && <div aria-hidden="true" style={{ height: bottomPad }} />}
    </div>
    {loadMore && <button className="btn-ghost btn-sm" onClick={loadMore}>{COPY.more}</button>}
  </>;
  return <HubPage frameless className={`fa-main${faceoff ? " has-faceoff" : ""}`}>
    <h1 className="sr-only">{COPY.title}</h1>
    <div className="fa-window"><div className="fa-window-copy"><strong>{title}</strong><span>{addMode === "claim" ? priority : !pickDraft && remainingCap != null ? COPY.capAvailable(remainingCap) : addMode === "locked" ? COPY.starHint : COPY.seasonOutlook}</span></div>
      <button className="fa-icon" aria-label={COPY.howAddsWork} aria-expanded={infoOpen} aria-controls="fa-how-adds" onClick={() => setInfoOpen(v => !v)}><Icon /></button></div>
    {infoOpen && <div className="fa-info" id="fa-how-adds"><p>{banner?.text || COPY.howAddsBody}</p>{banner?.text && <p>{COPY.howAddsBody}</p>}{addMode === "add" && !pickDraft && <p>{COPY.nativeInstantTerms}</p>}{faceoff && <p>{FO.howFaceoff}</p>}</div>}
    {addMode === "claim" && <>{!claimsReady || !priority || priority === CLAIM_QUEUE_COPY.needsConfirm ? claimContent : <details className="fa-claims-disclosure"><summary>{COPY.claimCount(claims.length)} · {priority}</summary>{claimContent}</details>}</>}
    {notice && <p className={`fa-status${notice.saved ? " is-saved" : ""}`} role="status" tabIndex={-1} ref={noticeRef}>{notice.saved && <span className="fa-kicker">{FO.savedKicker}</span>}<span>{notice.text}</span>{notice.onUndo && <button type="button" className="fa-link" disabled={busy} onClick={notice.onUndo}>{FO.undo}</button>}</p>}
    {faceoff ? <div className="fa-faceoff">
      <RosterColumn faceoff={faceoff} mode={addMode} onTarget={onTarget} busy={busy} />
      <div className="fa-poolside">
        <Scoreboard faceoff={faceoff} mode={addMode} />
        <SpotRail faceoff={faceoff} mode={addMode} onTarget={onTarget} busy={busy} />
        {pool}
      </div>
    </div> : pool}
    {draft && <ActionSheet key={draft.row.player_id} draft={draft} media={media} scale={scale} mode={addMode} canAct={canAct(draft.row)} busy={busy} error={error} onClose={onClose} onChange={onChange} onConfirm={onConfirm} remainingCap={remainingCap} pickDraft={pickDraft} rules={rules} riskTolerance={riskTolerance} roster={roster} priority={priority} onHistory={onHistory} onWatch={onWatch} watched={watched(draft.row.player_id)} reason={reasonFor(draft.row)} faceoff={faceoff} />}
  </HubPage>;
}
