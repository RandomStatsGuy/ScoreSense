import React, { useCallback, useEffect, useRef, useState } from "react";
import { PAINT_WIDTH, headshotCandidates, paintMediaUrl, playerInitials, teamLogoUrl } from "./draftMedia";
import { espnHeadshotUrl, opponentLabel, VIBE_COPY } from "./vibeRankingsPresentation";
import { AURA_MAX, AURA_MIN, formatAura, formatPts, readAura, vibeScore } from "./vibeAura";
import { buildVibeLatest, buildVibeMatchup } from "./vibeMatchup";
import { buildVibeProfile } from "./vibeProfile";

const COMMIT_PX = 88;
const LOCK_PX = 10;
const FLY_MS = 180;
const idleDrag = () => ({ dx: 0, active: false, leaving: null, returning: false });
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function VoteIcon({ higher }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={`M12 5v14M7 ${higher ? "10l5-5 5 5" : "14l5 5 5-5"}`} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CardFace({ player, media, aura, overlay, matchup, latest, open, onToggle, front }) {
  const [shotIndex, setShotIndex] = useState(0);
  const row = media?.[player.player_id] || {};
  const shots = headshotCandidates(row, [espnHeadshotUrl(player.espn_id)], { width: PAINT_WIDTH.hero });
  const headshot = shots[shotIndex] || (shotIndex === shots.length ? paintMediaUrl(teamLogoUrl(player.team), PAINT_WIDTH.hero) : null);
  const profile = open ? buildVibeProfile(player, media) : null;
  const news = open ? buildVibeLatest(player, latest) : null;
  const flags = [player.position, player.team, opponentLabel(player), player.on_bye ? VIBE_COPY.onBye : null, player.injured ? VIBE_COPY.injured : null].filter(Boolean);
  useEffect(() => setShotIndex(0), [player.player_id, row.headshot_url, row.espn_headshot_url]);
  return <>
    <div className="hub-vibes-card-face" hidden={open}>
      <div className="hub-vibes-photo">
        <span className="hub-vibes-team-mark" aria-hidden="true">{player.team}</span>
        {headshot ? <img src={headshot} alt="" width="256" height="256" draggable={false} decoding="async" fetchpriority={front ? "high" : "low"} onError={() => setShotIndex((n) => n + 1)} /> : <span className="hub-vibes-photo-fallback">{playerInitials(player.player_name)}</span>}
        <span className="hub-vibes-stamp hub-vibes-stamp--start" aria-hidden="true" style={{ opacity: overlay.start }}>{VIBE_COPY.stampStart}</span>
        <span className="hub-vibes-stamp hub-vibes-stamp--sit" aria-hidden="true" style={{ opacity: overlay.sit }}>{VIBE_COPY.stampSit}</span>
      </div>
      <div className="hub-vibes-identity">
        <div><h2 className="hub-vibes-name">{player.player_name}</h2><p className="hub-vibes-meta">{flags.join(" · ")}</p></div>
        {front ? <button type="button" className="hub-vibes-more" aria-expanded={open} aria-controls="vibes-player-details" aria-label={VIBE_COPY.openMoreNamed(player.player_name)} onClick={onToggle}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" /><path d="M12 11v6M12 7v1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg><span>{VIBE_COPY.moreLabel}</span></button> : <span className="hub-vibes-details-slot" />}
      </div>
      <dl className="hub-vibes-stats" aria-label={VIBE_COPY.weekCompare}>
        <div><dt>{VIBE_COPY.weekProj}</dt><dd>{formatPts(player.p50)} <small>{VIBE_COPY.points}</small></dd></div>
        <div><dt>{VIBE_COPY.vibeProj}</dt><dd>{formatPts(vibeScore(player, aura))} <small>{VIBE_COPY.points}</small></dd></div>
      </dl>
      <div className="hub-vibes-aura"><div className="hub-vibes-aura-scale"><span>{VIBE_COPY.auraLabel} <strong>{formatAura(aura)}</strong> / {AURA_MAX}</span><span>{VIBE_COPY.beforeRating}</span></div><div className="hub-vibes-aura-bar" role={front ? "meter" : undefined} aria-label={front ? VIBE_COPY.auraMeter : undefined} aria-valuemin={front ? AURA_MIN : undefined} aria-valuemax={front ? AURA_MAX : undefined} aria-valuenow={front ? aura : undefined}><i style={{ width: `${aura / AURA_MAX * 100}%` }} /></div></div>
    </div>
    {front && <section id="vibes-player-details" className="hub-vibes-profile" hidden={!open} aria-label={VIBE_COPY.moreLabel}>
      <button type="button" className="hub-vibes-profile-back" onClick={onToggle}>{VIBE_COPY.backToPlayer}</button>
      <h2 className="hub-vibes-name">{player.player_name}</h2><p className="hub-vibes-meta">{flags.join(" · ")}</p>
      <dl className="hub-vibes-facts">{[...(profile?.facts || []), ...matchup.facts].map((fact) => <div key={fact.id || fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      {profile?.bio && <p className="hub-vibes-bio">{profile.bio}</p>}
      <div className="hub-vibes-news"><h3>{VIBE_COPY.profileLatest}</h3>{news?.headline || news?.detail ? <>{news.headline && <p>{news.headline}</p>}{news.detail && <p className="hub-vibes-bio">{news.detail}</p>}{news.source && <p className="hub-vibes-news-source">{news.source}</p>}</> : <p className="hub-vibes-bio">{VIBE_COPY.profileEmptyNews}</p>}</div>
    </section>}
  </>;
}

export default function VibeSwipeDeck({ players, index = 0, auraById, media, vegasTeams, latestById, onProfileOpen, onSwipe, onBusyChange, onDoneFocus, disabled = false }) {
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const busyRef = useRef(false);
  const flyTimer = useRef(null);
  const voteRefs = useRef({});
  const [drag, setDrag] = useState(idleDrag);
  const [open, setOpen] = useState(false);
  const front = players[index] || null;
  const frontRef = useRef(front); frontRef.current = front;
  const callbacks = useRef({ onSwipe, onBusyChange, onDoneFocus }); callbacks.current = { onSwipe, onBusyChange, onDoneFocus };
  useEffect(() => { setOpen(false); dragRef.current = null; setDrag(idleDrag()); }, [front?.player_id]);
  useEffect(() => () => { clearTimeout(flyTimer.current); callbacks.current.onBusyChange?.(false); }, []);

  const finish = useCallback((vibe, focus = false) => {
    const player = frontRef.current;
    if (!player || disabled || busyRef.current) return;
    busyRef.current = true; callbacks.current.onBusyChange?.(true);
    const done = () => {
      dragRef.current = null; busyRef.current = false; setOpen(false); setDrag(idleDrag());
      callbacks.current.onSwipe?.(vibe, player); callbacks.current.onBusyChange?.(false);
      if (focus) requestAnimationFrame(() => voteRefs.current[vibe] ? voteRefs.current[vibe].focus({ preventScroll: true }) : callbacks.current.onDoneFocus?.());
    };
    if (reducedMotion()) done();
    else { setDrag((cur) => ({ ...cur, active: false, returning: false, leaving: vibe })); flyTimer.current = setTimeout(done, FLY_MS); }
  }, [disabled]);

  const cancelDrag = () => { dragRef.current = null; setDrag({ ...idleDrag(), returning: true }); };
  const onPointerDown = (event) => {
    if (disabled || !front || open || busyRef.current || event.button !== 0 || event.target.closest("button,a,summary")) return;
    dragRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, axis: null };
  };
  const onPointerMove = (event) => {
    const start = dragRef.current;
    if (!start || busyRef.current || event.pointerId !== start.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
      if (Math.abs(dy) > Math.abs(dx)) { dragRef.current = null; return; }
      start.axis = "x"; event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDrag({ dx, active: true, leaving: null, returning: false });
  };
  const onPointerUp = (event) => {
    const start = dragRef.current;
    if (!start || event.pointerId !== start.pointerId) return;
    const dx = event.clientX - start.x;
    const commit = start.axis === "x" && Math.abs(dx) >= COMMIT_PX && event.type === "pointerup";
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit) finish(dx > 0 ? "start" : "sit"); else cancelDrag();
  };
  const toggleProfile = () => {
    setOpen((cur) => !cur);
    if (!open) onProfileOpen?.(front);
    requestAnimationFrame(() => wrapRef.current?.querySelector(open ? ".hub-vibes-more" : ".hub-vibes-profile-back")?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); requestAnimationFrame(() => wrapRef.current?.querySelector(".hub-vibes-more")?.focus({ preventScroll: true })); return; }
      if (open || event.target.closest?.("input,textarea,select,button,a,summary,[contenteditable=true]")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); finish(event.key === "ArrowRight" ? "start" : "sit"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [finish, open]);
  if (!front) return null;
  const strength = drag.leaving ? 1 : Math.min(1, Math.abs(drag.dx) / COMMIT_PX);
  const direction = drag.leaving === "start" ? 1 : drag.leaving === "sit" ? -1 : 0;
  const frontDx = direction ? direction * ((wrapRef.current?.clientWidth || 320) + 80) : drag.dx;
  const rotate = reducedMotion() ? 0 : Math.max(-14, Math.min(14, frontDx / 16));
  return <>
    <div className="hub-vibes-deck-wrap" ref={wrapRef}>
      {players.length - index > 2 && <div className="hub-vibes-deep-card" aria-hidden="true" />}
      {players.slice(index, index + 2).map((player, depth) => {
        const isFront = depth === 0;
        return <article key={player.player_id} aria-label={isFront ? VIBE_COPY.currentPlayer : undefined} aria-hidden={!isFront || undefined}
          className={`hub-vibes-card${isFront ? " is-front" : " is-stack"}${isFront && drag.active ? " is-dragging" : ""}${isFront && drag.leaving ? " is-flying" : ""}${isFront && drag.returning ? " is-returning" : ""}${isFront && open ? " is-open" : ""}`}
          style={{ transform: isFront ? `translateX(${frontDx}px) rotate(${rotate}deg)` : `translateY(${14 * (1 - strength)}px) scale(${.97 + .03 * strength})` }}
          onPointerDown={isFront ? onPointerDown : undefined} onPointerMove={isFront ? onPointerMove : undefined} onPointerUp={isFront ? onPointerUp : undefined} onPointerCancel={isFront ? onPointerUp : undefined}
          onLostPointerCapture={isFront ? (event) => { if (event.target === event.currentTarget && dragRef.current?.pointerId === event.pointerId && !event.currentTarget.hasPointerCapture(event.pointerId)) cancelDrag(); } : undefined}>
          <CardFace player={player} media={media} aura={readAura(auraById, player.player_id)} overlay={{ start: isFront && frontDx > 0 ? strength : 0, sit: isFront && frontDx < 0 ? strength : 0 }} matchup={buildVibeMatchup(player, vegasTeams)} latest={latestById?.[player.player_id]} open={isFront && open} onToggle={toggleProfile} front={isFront} />
        </article>;
      })}
    </div>
    <div className="hub-vibes-votes" role="group" aria-label={VIBE_COPY.rateGroup}>{["sit", "start"].map((vibe) => <button key={vibe} ref={(node) => { voteRefs.current[vibe] = node; }} type="button" className="hub-vibes-vote" disabled={disabled || Boolean(drag.leaving)} aria-label={VIBE_COPY.rateNamed(front.player_name, vibe)} onClick={() => finish(vibe, true)}><span className="hub-vibes-vote-circle"><VoteIcon higher={vibe === "start"} /></span><span>{vibe === "start" ? VIBE_COPY.start : VIBE_COPY.sit}</span></button>)}</div>
  </>;
}
