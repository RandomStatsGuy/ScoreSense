import React, { useCallback, useEffect, useRef, useState } from "react";
import { headshotCandidates, playerInitials, teamLogoUrl } from "./draftMedia";
import { espnHeadshotUrl, opponentLabel, VIBE_COPY } from "./vibeRankingsPresentation";
import { auraTone, formatAura, formatPts, readAura, vibeScore } from "./vibeAura";
import { buildVibeProfile } from "./vibeProfile";

const COMMIT_PX = 88;
const LOCK_PX = 10;
const MAX_ROTATE = 14;
const FLY_MS = 200;

function cardMedia(player, media) {
  const row = media?.[player.player_id] || {};
  return headshotCandidates(row, [espnHeadshotUrl(player.espn_id)]);
}

function VibeCardFace({ player, media, aura, overlay }) {
  const [shotIndex, setShotIndex] = useState(0);
  const shots = cardMedia(player, media);
  const headshot = shots[shotIndex] || null;
  const logo = teamLogoUrl(player.team);
  const tone = auraTone(aura);
  const vibePts = vibeScore(player, aura);
  const profile = buildVibeProfile(player, media);

  useEffect(() => {
    setShotIndex(0);
  }, [player.player_id]);

  const flags = [
    player.position,
    player.team,
    opponentLabel(player),
    player.on_bye ? VIBE_COPY.onBye : null,
    player.injured ? VIBE_COPY.injured : null,
  ].filter(Boolean);

  return (
    <>
      <div className="hub-vibes-photo">
        {headshot ? (
          <img
            src={headshot}
            alt=""
            draggable={false}
            onError={() => setShotIndex((n) => n + 1)}
          />
        ) : logo ? (
          <img src={logo} alt="" draggable={false} />
        ) : (
          <div className="hub-vibes-photo-fallback">{playerInitials(player.player_name)}</div>
        )}
        <div className="hub-vibes-photo-fade" />
        <span
          className="hub-vibes-stamp hub-vibes-stamp--start"
          style={{ opacity: overlay.start }}
        >
          {VIBE_COPY.stampStart}
        </span>
        <span
          className="hub-vibes-stamp hub-vibes-stamp--sit"
          style={{ opacity: overlay.sit }}
        >
          {VIBE_COPY.stampSit}
        </span>
      </div>
      <div className="hub-vibes-identity">
        <h3 className="hub-vibes-name">{player.player_name}</h3>
        <p className="hub-vibes-meta">{flags.join(" · ")}</p>
        <div className="hub-vibes-stats">
          <div className="hub-vibes-stat">
            <span>{VIBE_COPY.weekProj}</span>
            <strong>{formatPts(player.p50)}</strong>
          </div>
          <div className="hub-vibes-stat">
            <span>{VIBE_COPY.vibeProj}</span>
            <strong>{formatPts(vibePts)}</strong>
          </div>
          <div className={`hub-vibes-stat hub-vibes-stat--${tone}`}>
            <span>{VIBE_COPY.auraLabel}</span>
            <strong>{formatAura(aura)}</strong>
          </div>
        </div>
        <div className={`hub-vibes-aura-bar is-${tone}`} aria-hidden="true">
          <i style={{ width: `${aura}%` }} />
        </div>
        <p className="hub-vibes-scroll-hint">{VIBE_COPY.profileScroll}</p>
      </div>
      <div className="hub-vibes-profile">
        <p className="hub-vibes-about">{VIBE_COPY.profileAbout}</p>
        {profile.facts.length ? (
          <dl className="hub-vibes-facts">
            {profile.facts.map((row) => (
              <div key={row.id} className="hub-vibes-fact">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {profile.bio ? <p className="hub-vibes-bio">{profile.bio}</p> : null}
      </div>
    </>
  );
}

export default function VibeSwipeDeck({
  players,
  index,
  auraById,
  media,
  onSwipe,
  disabled = false,
}) {
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const flyTimer = useRef(null);
  const [drag, setDrag] = useState({ dx: 0, active: false, leaving: null });

  const front = players[index] || null;
  const stacked = players.slice(index, index + 3);

  const finish = useCallback((vibe, fromDx) => {
    if (!front || disabled || dragRef.current?.locked) return;
    if (dragRef.current) dragRef.current.locked = true;
    const dir = vibe === "start" ? 1 : -1;
    const width = wrapRef.current?.offsetWidth || 320;
    setDrag({ dx: fromDx, active: false, leaving: { vibe, x: dir * (width + 80) } });
    if (flyTimer.current) window.clearTimeout(flyTimer.current);
    flyTimer.current = window.setTimeout(() => {
      dragRef.current = null;
      setDrag({ dx: 0, active: false, leaving: null });
      onSwipe?.(vibe, front);
    }, FLY_MS);
  }, [disabled, front, onSwipe]);

  const onPointerDown = (event) => {
    if (disabled || !front || dragRef.current?.locked) return;
    if (event.button != null && event.button !== 0) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastT: event.timeStamp,
      vx: 0,
      dx: 0,
      axis: null,
      pointerId: event.pointerId,
      target: event.currentTarget,
      locked: false,
    };
  };

  const onPointerMove = (event) => {
    const start = dragRef.current;
    if (!start || start.locked) return;

    if (start.axis === "y") {
      if (event.pointerType !== "touch") {
        start.target.scrollTop -= event.clientY - start.lastY;
        start.lastY = event.clientY;
      }
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (start.axis == null) {
      if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        start.axis = "y";
        return;
      }
      start.axis = "x";
      try {
        start.target.setPointerCapture?.(start.pointerId);
      } catch {
        /* already released */
      }
    }

    if (start.axis !== "x") return;

    const dt = Math.max(1, event.timeStamp - start.lastT);
    start.vx = (event.clientX - start.lastX) / dt;
    start.lastX = event.clientX;
    start.lastT = event.timeStamp;
    start.dx = dx;
    setDrag({ dx, active: true, leaving: null });
  };

  const onPointerUp = () => {
    const start = dragRef.current;
    if (!start || start.locked) return;
    if (start.axis === "x") {
      try {
        start.target.releasePointerCapture?.(start.pointerId);
      } catch {
        /* already released */
      }
      const dx = start.dx;
      const flick = Math.abs(start.vx) > 0.45 && Math.abs(dx) > 28;
      if (dx > COMMIT_PX || (flick && dx > 0)) {
        finish("start", dx);
        return;
      }
      if (dx < -COMMIT_PX || (flick && dx < 0)) {
        finish("sit", dx);
        return;
      }
    }
    dragRef.current = null;
    setDrag({ dx: 0, active: false, leaving: null });
  };

  useEffect(() => {
    const onKey = (event) => {
      if (disabled || !front || dragRef.current?.locked) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        finish("start", 0);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        finish("sit", 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (flyTimer.current) window.clearTimeout(flyTimer.current);
    };
  }, [disabled, finish, front]);

  if (!front) return null;

  const leaving = drag.leaving;
  const frontDx = leaving ? leaving.x : drag.dx;
  const rotate = Math.max(-MAX_ROTATE, Math.min(MAX_ROTATE, frontDx * 0.045));
  const startOpacity = Math.max(0, Math.min(1, frontDx / COMMIT_PX));
  const sitOpacity = Math.max(0, Math.min(1, -frontDx / COMMIT_PX));
  const reduced = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const transition = drag.active
    ? "none"
    : (reduced ? "none" : `transform ${FLY_MS}ms var(--ease-standard)`);

  return (
    <div
      ref={wrapRef}
      className="hub-vibes-deck-wrap"
      aria-live="polite"
      aria-label={`${front.player_name}. ${VIBE_COPY.swipeHint}`}
    >
      {stacked.map((player, stackIndex) => {
        const isFront = stackIndex === 0;
        const depth = stackIndex;
        const scale = 1 - depth * 0.045;
        const lift = depth * 10;
        const transform = isFront
          ? `translateX(${frontDx}px) rotate(${reduced ? 0 : rotate}deg)`
          : `translateY(${lift}px) scale(${scale})`;
        return (
          <article
            key={player.player_id}
            className={`hub-vibes-card${isFront ? " is-front" : ""}${drag.active && isFront ? " is-dragging" : ""}${depth ? ` is-stack-${depth}` : ""}`}
            style={{
              transform,
              transition: isFront ? transition : "transform 160ms var(--ease-standard)",
              zIndex: 5 - depth,
            }}
            onPointerDown={isFront ? onPointerDown : undefined}
            onPointerMove={isFront ? onPointerMove : undefined}
            onPointerUp={isFront ? onPointerUp : undefined}
            onPointerCancel={isFront ? onPointerUp : undefined}
          >
            <VibeCardFace
              player={player}
              media={media}
              aura={readAura(auraById, player.player_id)}
              overlay={isFront ? { start: startOpacity, sit: sitOpacity } : { start: 0, sit: 0 }}
            />
          </article>
        );
      })}
    </div>
  );
}
