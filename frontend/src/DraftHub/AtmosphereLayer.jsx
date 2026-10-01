import React, { useEffect, useMemo, useState } from "react";
import { CompanionFloor } from "./CompanionScene";
import { apiFetch } from "../auth";
import { ATMOSPHERE_CHANGED_EVENT, mergeAtmospherePrefs, shouldShowAtmosphere } from "./atmosphereCatalog";
import {
  FOOTBALL,
  LEAF_VARIANTS,
  SNOW_ARM_PATH,
  buildAtmosphereParticles,
  intensityPreset,
} from "./atmosphereArt";

export function usePrefersReducedMotion() {
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

function MouseSvg({ particle }) {
  return <svg width={particle.size} height={particle.size} viewBox="0 0 100 100" aria-hidden="true">
    <path d="M28 63Q5 79 12 47" fill="none" stroke="#b786ac" strokeWidth="5" strokeLinecap="round" />
    <ellipse cx="50" cy="52" rx="30" ry="20" fill="#d8b8d0" stroke="#896a84" strokeWidth="3" />
    <circle cx="58" cy="32" r="13" fill="#e6cbdc" stroke="#896a84" strokeWidth="3" />
    <circle cx="72" cy="48" r="4" fill="#66515c" /><circle cx="82" cy="55" r="5" fill="#c890a2" />
  </svg>;
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
    if (particle.variant === 1) return <MouseSvg particle={particle} />;
    if (particle.variant === 2) return <YarnSvg particle={particle} />;
    return <SoftDot particle={particle} color="rgba(255, 236, 200, 0.85)" />;
  }
  return <FootballSvg particle={particle} />;
}

/* ---------------- the layer ---------------- */

export default function AtmosphereLayer({ theme = "none", liveDraft = false, prefsOverride = null, className = "", fieldOnly = false, sceneOnly = false }) {
  const [fetchedPrefs, setFetchedPrefs] = useState(() => mergeAtmospherePrefs({ atmosphere: theme }));
  const reducedMotion = usePrefersReducedMotion();

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
  const active = prefs.enabled !== false && shouldShowAtmosphere(activeTheme, { liveDraft });
  /** Reduced motion freezes the scene: no falling particles, static pile,
   * sleeping cats — the wash and pile still set the mood. */
  const motionOn = active && prefs.motion && prefs.falling !== false && !reducedMotion;
  const preset = intensityPreset(prefs.intensity);

  const particles = useMemo(
    () => (motionOn && !sceneOnly ? buildAtmosphereParticles(activeTheme, { density: preset.density }) : []),
    [motionOn, activeTheme, preset.density, sceneOnly],
  );
  const companionsOn = active && prefs.companions !== false && !fieldOnly;
  const reactionsOn = companionsOn && prefs.motion && prefs.reactions !== false && !reducedMotion;

  if (!active || (sceneOnly && !companionsOn)) return null;

  return (
    <div
      className={`hub-atmosphere hub-atmosphere--${activeTheme}${!reducedMotion && prefs.motion ? "" : " hub-atmosphere--still"} ${className}`.trim()}
      style={{ "--atm-alpha": preset.opacity }}
      aria-hidden={fieldOnly ? true : undefined}
    >
      {prefs.wash && !sceneOnly && (
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

      {companionsOn && <CompanionFloor theme={activeTheme} reactions={reactionsOn} ground={prefs.pile} />}

    </div>
  );
}
