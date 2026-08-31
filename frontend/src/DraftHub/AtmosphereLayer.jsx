import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { mergeAtmospherePrefs, shouldShowAtmosphere } from "./atmosphereCatalog";
import {
  FOOTBALL,
  LEAF_VARIANTS,
  SNOW_ARM_PATH,
  buildAtmosphereParticles,
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

function SnowSvg({ particle }) {
  if (particle.variant === 0) {
    const gradientId = `atm-${particle.id}`;
    return (
      <svg width={particle.size} height={particle.size} viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0" stopColor="rgba(240, 246, 255, 0.95)" />
            <stop offset="1" stopColor="rgba(240, 246, 255, 0)" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="44" fill={`url(#${gradientId})`} />
      </svg>
    );
  }
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

function FootballSvg({ particle }) {
  const gradientId = `atm-${particle.id}`;
  const [c1, c2, c3] = FOOTBALL.colors;
  return (
    <svg
      width={particle.size}
      height={particle.size * 0.62}
      viewBox="0 0 120 74"
      aria-hidden="true"
    >
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

function ParticleArt({ particle }) {
  if (particle.theme === "leaves") return <LeafSvg particle={particle} />;
  if (particle.theme === "snow") return <SnowSvg particle={particle} />;
  return <FootballSvg particle={particle} />;
}

const CURSOR_RADIUS = 150;
const CURSOR_PUSH = 42;

/** Gently push mid/near particles away from the pointer. rAF only runs while
 * the layer is active, the tab is visible, and the device has a hover pointer. */
function useCursorDrift(containerRef, active, particleKey) {
  useEffect(() => {
    if (!active || typeof window === "undefined" || !window.matchMedia) return undefined;
    if (!window.matchMedia("(hover: hover)").matches) return undefined;
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
    if (!nodes.length) return undefined;

    const mouse = { x: -9999, y: -9999 };
    let frame = 0;
    let running = true;

    const onMove = (event) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    const tick = () => {
      if (!running) return;
      if (document.visibilityState === "visible") {
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
      }
      frame = window.requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    frame = window.requestAnimationFrame(tick);
    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [containerRef, active, particleKey]);
}

export default function AtmosphereLayer({ theme = "none", liveDraft = false }) {
  const [savedTheme, setSavedTheme] = useState(theme);
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = useRef(null);

  useEffect(() => {
    setSavedTheme(theme);
  }, [theme]);

  useEffect(() => {
    const load = async (signal) => {
      try {
        const res = await apiFetch("/api/hub/prefs", { signal });
        if (!res.ok) return;
        const data = await res.json();
        setSavedTheme(mergeAtmospherePrefs(data.prefs).atmosphere);
      } catch {
        /* keep prop / last known theme */
      }
    };
    const ctrl = new AbortController();
    load(ctrl.signal);
    const onVis = () => {
      if (document.visibilityState === "visible") load(ctrl.signal);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const active = shouldShowAtmosphere(savedTheme, { reducedMotion, liveDraft });
  const particles = useMemo(
    () => (active ? buildAtmosphereParticles(savedTheme) : []),
    [active, savedTheme],
  );

  useCursorDrift(containerRef, active && particles.length > 0, savedTheme);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      className={`hub-atmosphere hub-atmosphere--${savedTheme}`}
      aria-hidden="true"
    >
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
    </div>
  );
}
