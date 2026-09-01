import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { ATMOSPHERE_CHANGED_EVENT, mergeAtmospherePrefs, shouldShowAtmosphere } from "./atmosphereCatalog";
import {
  FOOTBALL,
  FUR_TUFT,
  LEAF_VARIANTS,
  SNOW_ARM_PATH,
  buildAtmosphereParticles,
  buildPileClusters,
  intensityPreset,
} from "./atmosphereArt";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/* ---------------- falling particle artwork ---------------- */

function LeafSvg({ particle }) {
  const variant = LEAF_VARIANTS[particle.variant] || LEAF_VARIANTS[0];
  const [c1, c2] = particle.colors || ["#c45c26", "#8a3312"];
  const gradientId = `atm-${particle.id}`;
  return (
    <svg width={particle.size} height={particle.size} viewBox="0 0 100 110" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      <path
        d={variant.body}
        fill={`url(#${gradientId})`}
        stroke="rgba(0, 0, 0, 0.3)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d={variant.stem} stroke={c2} strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <path d={variant.veins} stroke="rgba(0, 0, 0, 0.28)" strokeWidth="2" fill="none" />
    </svg>
  );
}

function SoftDot({ particle, color = "rgba(240, 246, 255, 0.95)" }) {
  const gradientId = `atm-${particle.id}`;
  return (
    <svg width={particle.size} height={particle.size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor="rgba(240, 246, 255, 0)" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill={`url(#${gradientId})`} />
    </svg>
  );
}

function SnowSvg({ particle }) {
  if (particle.variant === 0) return <SoftDot particle={particle} />;
  return (
    <svg
      width={particle.size}
      height={particle.size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ stroke: "rgba(233, 241, 255, 0.92)", strokeWidth: 4.5, strokeLinecap: "round", fill: "none" }}
    >
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <g key={angle} transform={`rotate(${angle} 50 50)`}>
          <path d={SNOW_ARM_PATH} />
        </g>
      ))}
      <circle cx="50" cy="50" r="5" fill="rgba(233, 241, 255, 0.92)" stroke="none" />
    </svg>
  );
}

function FootballSvg({ particle, size }) {
  const gradientId = `atm-${particle.id}`;
  const [c1, c2, c3] = FOOTBALL.colors;
  const width = size ?? particle.size;
  return (
    <svg width={width} height={width * 0.62} viewBox="0 0 120 74" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="0.5" stopColor={c2} />
          <stop offset="1" stopColor={c3} />
        </linearGradient>
      </defs>
      <ellipse
        cx={FOOTBALL.body.cx}
        cy={FOOTBALL.body.cy}
        rx={FOOTBALL.body.rx}
        ry={FOOTBALL.body.ry}
        fill={`url(#${gradientId})`}
        stroke="rgba(0, 0, 0, 0.4)"
        strokeWidth="2"
      />
      <path d={FOOTBALL.sheen} stroke="rgba(255, 255, 255, 0.18)" strokeWidth="5" fill="none" />
      <path d={FOOTBALL.seam} stroke="#f3efe6" strokeWidth="3" fill="none" />
      {FOOTBALL.laceXs.map((x) => (
        <path
          key={x}
          d={`M${x} ${FOOTBALL.laceY[0]} L${x} ${FOOTBALL.laceY[1]}`}
          stroke="#f3efe6"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      ))}
      {FOOTBALL.stripes.map((d) => (
        <path key={d} d={d} stroke="#f3efe6" strokeWidth="3" fill="none" />
      ))}
    </svg>
  );
}

function FurSvg({ particle }) {
  const [c1, c2] = particle.colors || ["#efe6d8", "#cbbba6"];
  const gradientId = `atm-${particle.id}`;
  return (
    <svg width={particle.size} height={particle.size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={gradientId} cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </radialGradient>
      </defs>
      <path d={FUR_TUFT.body} fill={`url(#${gradientId})`} opacity="0.9" />
      <path
        d={FUR_TUFT.hairs}
        stroke={c2}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        opacity="0.8"
      />
    </svg>
  );
}

function YarnSvg({ particle }) {
  const [c1, c2] = particle.colors || ["#c98a8a", "#8f5a5a"];
  const gradientId = `atm-${particle.id}`;
  return (
    <svg width={particle.size} height={particle.size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={gradientId} cx="0.35" cy="0.3" r="0.9">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="46" r="34" fill={`url(#${gradientId})`} stroke={c2} strokeWidth="2" />
      <path
        d="M20 36 Q50 20 80 36 M16 48 Q50 34 84 48 M20 60 Q50 48 80 60 M28 70 Q52 60 74 70"
        stroke={c2}
        strokeWidth="2.6"
        fill="none"
        opacity="0.85"
      />
      {/* trailing strand */}
      <path d="M78 66 Q94 78 88 92 Q84 98 76 96" stroke={c1} strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function ParticleArt({ particle }) {
  if (particle.theme === "leaves") return <LeafSvg particle={particle} />;
  if (particle.theme === "snow") return <SnowSvg particle={particle} />;
  if (particle.theme === "cozy") {
    if (particle.variant === 1) return <FurSvg particle={particle} />;
    if (particle.variant === 2) return <YarnSvg particle={particle} />;
    return <SoftDot particle={particle} color="rgba(255, 236, 200, 0.85)" />;
  }
  return <FootballSvg particle={particle} />;
}

/* ---------------- ground pile artwork ---------------- */

function DriftMound({ id, colors, wisps = false }) {
  const [c1, c2] = colors || ["#eef4ff", "#c8d6ee"];
  const gradientId = `pile-${id}`;
  return (
    <svg viewBox="0 0 200 60" className="hub-atmosphere-pile-svg" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      <path
        d="M0 60 Q30 24 70 34 Q100 10 140 30 Q175 22 200 60 Z"
        fill={`url(#${gradientId})`}
      />
      {wisps && (
        <path
          d="M52 32 C48 24 40 22 36 26 M104 16 C102 8 94 6 90 10 M150 26 C152 18 160 16 164 20"
          stroke={c2}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
          opacity="0.8"
        />
      )}
    </svg>
  );
}

function LeafPileMound({ id, colors }) {
  const [c1, c2] = colors || ["#c45c26", "#8a3312"];
  const gradientId = `pile-${id}`;
  return (
    <svg viewBox="0 0 200 60" className="hub-atmosphere-pile-svg" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      <path d="M0 60 Q34 28 78 36 Q110 14 148 32 Q178 26 200 60 Z" fill={`url(#${gradientId})`} />
      {/* loose leaves resting on the crest */}
      <path d="M70 30 C76 22 86 22 88 30 C84 36 74 36 70 30 Z" fill={c1} stroke={c2} strokeWidth="1.5" />
      <path d="M118 18 C124 10 134 10 136 18 C132 24 122 24 118 18 Z" fill={c2} stroke={c1} strokeWidth="1.5" />
      <path d="M40 40 C46 32 56 32 58 40 C54 46 44 46 40 40 Z" fill={c2} opacity="0.85" />
    </svg>
  );
}

function FootballPileMound({ id, variant = 2 }) {
  const count = Math.max(1, Math.min(3, variant + 1));
  const positions = count === 3
    ? [{ x: 16, y: 28 }, { x: 86, y: 30 }, { x: 50, y: 2 }]
    : count === 2
      ? [{ x: 24, y: 26 }, { x: 84, y: 28 }]
      : [{ x: 52, y: 24 }];
  return (
    <svg viewBox="0 0 200 82" className="hub-atmosphere-pile-svg hub-atmosphere-pile-svg--balls" aria-hidden="true">
      {positions.map((pos, i) => (
        <g key={i} transform={`translate(${pos.x} ${pos.y}) scale(0.82)`}>
          <FootballPileBall id={`${id}-${i}`} />
        </g>
      ))}
    </svg>
  );
}

function FootballPileBall({ id }) {
  const [c1, c2, c3] = FOOTBALL.colors;
  const gradientId = `pileball-${id}`;
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="0.5" stopColor={c2} />
          <stop offset="1" stopColor={c3} />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="37" rx="56" ry="30" fill={`url(#${gradientId})`} stroke="rgba(0,0,0,0.4)" strokeWidth="2" />
      <path d={FOOTBALL.seam} stroke="#f3efe6" strokeWidth="3" fill="none" />
      {FOOTBALL.laceXs.map((x) => (
        <path key={x} d={`M${x} 30 L${x} 44`} stroke="#f3efe6" strokeWidth="3.4" strokeLinecap="round" />
      ))}
    </>
  );
}

function FurPileMound({ id, colors }) {
  const [c1, c2] = colors || ["#efe6d8", "#cbbba6"];
  const gradientId = `pile-${id}`;
  return (
    <svg viewBox="0 0 200 70" className="hub-atmosphere-pile-svg" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c1} />
          <stop offset="1" stopColor={c2} />
        </linearGradient>
      </defs>
      <path
        d="M0 70 Q28 30 68 40 Q102 16 142 36 Q176 24 200 70 Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M46 38 C40 24 28 22 24 30 M96 20 C92 8 78 8 76 16 M148 32 C154 18 166 18 168 26"
        stroke={c2}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        opacity="0.85"
      />
      <path d="M72 34 C78 22 92 22 94 34 C90 42 76 42 72 34 Z" fill={c1} opacity="0.9" />
      <path d="M118 22 C124 10 138 12 138 24 C134 32 122 32 118 22 Z" fill={c2} opacity="0.8" />
    </svg>
  );
}

function PileClusterArt({ cluster, theme }) {
  if (theme === "snow") return <DriftMound id={cluster.id} colors={["#eef4ff", "#b9c9e6"]} />;
  if (theme === "leaves") return <LeafPileMound id={cluster.id} colors={cluster.colors} />;
  if (theme === "cozy") return <FurPileMound id={cluster.id} colors={cluster.colors || ["#efe6d8", "#cbbba6"]} />;
  return <FootballPileMound id={cluster.id} variant={cluster.variant} />;
}

/* ---------------- the ragdolls ---------------- */

/** Ragdoll cat in a loaf. Sleeping by default; the cursor loop toggles
 * `.is-alert` (ears up, eyes open + tracking via --look-x/y) and pulses
 * `.is-batting` (paw swipe) when you get close. */
function RagdollCat({ flip = false, point = "#8a7a6e", coat = "#efe6d8" }) {
  return (
    <svg
      viewBox="0 0 170 110"
      className="hub-atmosphere-cat-svg"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden="true"
    >
      {/* tail curled around the front */}
      <path
        className="hub-atm-cat-tail"
        d="M28 92 C6 92 2 74 14 66 C20 62 28 64 30 72"
        fill="none"
        stroke={point}
        strokeWidth="13"
        strokeLinecap="round"
      />
      {/* body loaf */}
      <path
        className="hub-atm-cat-body"
        d="M24 96 C16 74 34 52 66 50 L118 52 C140 54 152 68 150 82 C148 94 138 100 122 101 L44 101 C34 101 27 100 24 96 Z"
        fill={coat}
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="2"
      />
      {/* haunch shading */}
      <path d="M34 96 C28 78 40 60 62 55 C48 66 42 82 44 98 Z" fill={point} opacity="0.25" />
      {/* head */}
      <g className="hub-atm-cat-head">
        {/* ears */}
        <path className="hub-atm-cat-ear hub-atm-cat-ear--l" d="M104 38 L110 16 L124 32 Z" fill={point} />
        <path className="hub-atm-cat-ear hub-atm-cat-ear--r" d="M136 32 L152 20 L152 42 Z" fill={point} />
        <path d="M108 36 L112 24 L120 32 Z" fill="#d9a3a3" opacity="0.8" />
        <path d="M138 32 L148 25 L148 37 Z" fill="#d9a3a3" opacity="0.8" />
        {/* face */}
        <ellipse cx="128" cy="56" rx="30" ry="26" fill={coat} stroke="rgba(0,0,0,0.18)" strokeWidth="2" />
        {/* point mask */}
        <path d="M100 48 C104 34 152 34 156 48 C158 42 154 30 146 28 L110 28 C102 30 98 42 100 48 Z" fill={point} opacity="0.85" />
        {/* eyes: sleeping arcs vs open tracking eyes */}
        <g className="hub-atm-cat-eyes-closed">
          <path d="M112 56 Q117 60 122 56" stroke="#4a4038" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path d="M134 56 Q139 60 144 56" stroke="#4a4038" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        </g>
        <g className="hub-atm-cat-eyes-open">
          <ellipse cx="117" cy="56" rx="6" ry="6.5" fill="#eef6ff" />
          <ellipse cx="139" cy="56" rx="6" ry="6.5" fill="#eef6ff" />
          <g className="hub-atm-cat-pupils">
            <circle cx="117" cy="56.5" r="3.4" fill="#3c6ea5" />
            <circle cx="139" cy="56.5" r="3.4" fill="#3c6ea5" />
            <circle cx="118.2" cy="55.2" r="1.1" fill="#fff" />
            <circle cx="140.2" cy="55.2" r="1.1" fill="#fff" />
          </g>
        </g>
        {/* muzzle */}
        <path d="M124 64 L128 60 L132 64 L128 67 Z" fill="#d98d8d" />
        <path d="M128 67 Q128 72 122 73 M128 67 Q128 72 134 73" stroke="#4a4038" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        {/* whiskers */}
        <path
          d="M108 62 L88 58 M108 66 L90 68 M148 62 L166 58 M148 66 L164 68"
          stroke="rgba(74,64,56,0.6)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
      {/* front paws tucked; the near paw bats */}
      <path d="M96 101 Q98 92 108 92 Q118 92 119 101 Z" fill={coat} stroke="rgba(0,0,0,0.15)" strokeWidth="1.6" />
      <path
        className="hub-atm-cat-paw"
        d="M120 101 Q121 90 132 89 Q143 89 144 101 Z"
        fill={coat}
        stroke="rgba(0,0,0,0.15)"
        strokeWidth="1.6"
      />
    </svg>
  );
}

/* ---------------- cursor life: particle drift + cat reactions ---------------- */

const CURSOR_RADIUS = 150;
const CURSOR_PUSH = 42;
const CAT_WATCH_RADIUS = 280;
const CAT_BAT_RADIUS = 150;
const CAT_SLEEP_AFTER_MS = 3500;
const CAT_BAT_COOLDOWN_MS = 1000;

function useCursorLife(containerRef, active) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const nodes = Array.from(container.querySelectorAll("[data-atm-interactive='1']"))
      .map((el) => ({
        push: el.querySelector(".hub-atmosphere-push"),
        el,
        ox: 0,
        oy: 0,
      }))
      .filter((entry) => entry.push);
    const cats = Array.from(container.querySelectorAll("[data-atm-cat='1']")).map((el) => ({
      el,
      lastNear: 0,
      batUntil: 0,
      lastBat: 0,
    }));
    if (!nodes.length && !cats.length) return undefined;

    const mouse = { x: -9999, y: -9999 };
    let frame = 0;
    let running = true;
    let started = false;

    const onMove = (event) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      // Lazy-start on the first real pointer move — no device sniffing;
      // touch-only devices simply never pay for the loop until they drag.
      if (!started) {
        started = true;
        frame = window.requestAnimationFrame(tick);
      }
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    const tick = () => {
      if (!running) return;
      if (document.visibilityState === "visible") {
        const now = performance.now();
        for (const node of nodes) {
          const rect = node.el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = cx - mouse.x;
          const dy = cy - mouse.y;
          const distance = Math.hypot(dx, dy);
          let tx = 0;
          let ty = 0;
          if (distance < CURSOR_RADIUS && distance > 0.01) {
            const force = ((CURSOR_RADIUS - distance) / CURSOR_RADIUS) * CURSOR_PUSH;
            tx = (dx / distance) * force;
            ty = (dy / distance) * force;
          }
          node.ox += (tx - node.ox) * 0.14;
          node.oy += (ty - node.oy) * 0.14;
          node.push.style.transform = `translate(${node.ox.toFixed(1)}px, ${node.oy.toFixed(1)}px)`;
        }
        for (const cat of cats) {
          const rect = cat.el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = mouse.x - cx;
          const dy = mouse.y - cy;
          const distance = Math.hypot(dx, dy);
          if (distance < CAT_WATCH_RADIUS) {
            cat.lastNear = now;
            cat.el.classList.add("is-alert");
            const flipped = cat.el.dataset.atmFlip === "1";
            const lookX = Math.max(-1, Math.min(1, dx / CAT_WATCH_RADIUS)) * (flipped ? -2.6 : 2.6);
            const lookY = Math.max(-1, Math.min(1, dy / CAT_WATCH_RADIUS)) * 2;
            cat.el.style.setProperty("--look-x", `${lookX.toFixed(2)}px`);
            cat.el.style.setProperty("--look-y", `${lookY.toFixed(2)}px`);
            if (
              distance < CAT_BAT_RADIUS
              && now - cat.lastBat > CAT_BAT_COOLDOWN_MS
            ) {
              cat.lastBat = now;
              cat.batUntil = now + 900;
              cat.el.classList.add("is-batting");
            }
          } else if (cat.lastNear && now - cat.lastNear > CAT_SLEEP_AFTER_MS) {
            cat.el.classList.remove("is-alert");
            cat.lastNear = 0;
          }
          if (cat.batUntil && now > cat.batUntil) {
            cat.el.classList.remove("is-batting");
            cat.batUntil = 0;
          }
        }
      }
      frame = window.requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [containerRef, active]);
}

/* ---------------- the layer ---------------- */

export default function AtmosphereLayer({ theme = "none", liveDraft = false, prefsOverride = null }) {
  const [fetchedPrefs, setFetchedPrefs] = useState(() => mergeAtmospherePrefs({ atmosphere: theme }));
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = useRef(null);

  useEffect(() => {
    if (prefsOverride) return;
    setFetchedPrefs((prev) => ({ ...prev, atmosphere: theme }));
  }, [theme, prefsOverride]);

  useEffect(() => {
    if (prefsOverride) return undefined;
    const load = async (signal) => {
      try {
        const res = await apiFetch("/api/hub/prefs", { signal });
        if (!res.ok) return;
        const data = await res.json();
        setFetchedPrefs(mergeAtmospherePrefs(data.prefs));
      } catch {
        /* keep prop / last known prefs */
      }
    };
    const ctrl = new AbortController();
    load(ctrl.signal);
    const onVis = () => {
      if (document.visibilityState === "visible") load(ctrl.signal);
    };
    const onPrefs = () => load(ctrl.signal);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(ATMOSPHERE_CHANGED_EVENT, onPrefs);
    return () => {
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(ATMOSPHERE_CHANGED_EVENT, onPrefs);
    };
  }, [prefsOverride]);

  const prefs = prefsOverride || fetchedPrefs;

  const activeTheme = prefs.atmosphere;
  const active = shouldShowAtmosphere(activeTheme, { liveDraft });
  /** Reduced motion freezes the scene: no falling particles, static pile,
   * sleeping cats — the wash and pile still set the mood. */
  const motionOn = active && prefs.motion && !reducedMotion;
  const preset = intensityPreset(prefs.intensity);

  const particles = useMemo(
    () => (motionOn ? buildAtmosphereParticles(activeTheme, { density: preset.density }) : []),
    [motionOn, activeTheme, preset.density],
  );
  const pileClusters = useMemo(
    () => (active && prefs.pile ? buildPileClusters(activeTheme) : []),
    [active, prefs.pile, activeTheme],
  );

  useCursorLife(containerRef, motionOn && (particles.length > 0 || activeTheme === "cozy"));

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      className={`hub-atmosphere hub-atmosphere--${activeTheme}`}
      style={{ "--atm-alpha": preset.opacity }}
      aria-hidden="true"
    >
      {prefs.wash && (
        <div className={`hub-atmosphere-wash hub-atmosphere-wash--${activeTheme}`} />
      )}

      {particles.map((p) => (
        <span
          key={p.id}
          className={`hub-atmosphere-particle hub-atmosphere-particle--${p.layer}${p.spinMode === "rock" ? " hub-atmosphere-particle--rock" : ""}`}
          data-atm-interactive={p.interactive ? "1" : undefined}
          style={{
            left: `${p.left}%`,
            "--atm-fall-dur": `${p.fallDuration}s`,
            "--atm-fall-delay": `${p.fallDelay}s`,
            "--atm-drift": `${p.drift}px`,
            "--atm-sway": `${p.swayAmp}px`,
            "--atm-sway-dur": `${p.swayDuration}s`,
            "--atm-spin-dur": `${p.spinDuration}s`,
          }}
        >
          <span className="hub-atmosphere-push">
            <span className="hub-atmosphere-sway">
              <span className="hub-atmosphere-spin">
                <ParticleArt particle={p} />
              </span>
            </span>
          </span>
        </span>
      ))}

      {pileClusters.length > 0 && (
        <div
          className={`hub-atmosphere-pile${motionOn ? "" : " hub-atmosphere-pile--static"}`}
        >
          {pileClusters.map((cluster) => (
            <span
              key={cluster.id}
              className="hub-atmosphere-pile-cluster"
              style={{
                left: `${cluster.left}%`,
                "--pile-scale": cluster.scale,
                "--pile-delay": `${cluster.growDelay}s`,
                "--pile-flip": cluster.flip ? -1 : 1,
              }}
            >
              <PileClusterArt cluster={cluster} theme={activeTheme} />
            </span>
          ))}
        </div>
      )}
      {activeTheme === "cozy" && (
        <div className="hub-atmosphere-cats">
          <span
            className="hub-atmosphere-cat hub-atmosphere-cat--left"
            data-atm-cat="1"
          >
            <RagdollCat point="#8a7a6e" coat="#efe6d8" />
          </span>
          <span
            className="hub-atmosphere-cat hub-atmosphere-cat--right"
            data-atm-cat="1"
            data-atm-flip="1"
          >
            <RagdollCat flip point="#7e8494" coat="#e9e2d8" />
          </span>
        </div>
      )}
    </div>
  );
}
