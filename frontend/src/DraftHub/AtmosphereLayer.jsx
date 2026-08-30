import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { mergeAtmospherePrefs, shouldShowAtmosphere } from "./atmosphereCatalog";

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

function particlesFor(theme) {
  const count = theme === "footballs" ? 14 : 22;
  return Array.from({ length: count }, (_, i) => ({
    id: `${theme}-${i}`,
    left: `${(i * 37) % 100}%`,
    delay: `${(i * 0.35) % 8}s`,
    duration: `${10 + (i % 7)}s`,
    size: 8 + (i % 6),
    drift: (i % 2 === 0 ? 1 : -1) * (12 + (i % 10)),
  }));
}

export default function AtmosphereLayer({ theme = "none", liveDraft = false }) {
  const [savedTheme, setSavedTheme] = useState(theme);
  const reducedMotion = usePrefersReducedMotion();

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
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const active = shouldShowAtmosphere(savedTheme, { reducedMotion, liveDraft });
  const particles = useMemo(() => (active ? particlesFor(savedTheme) : []), [active, savedTheme]);

  if (!active) return null;

  return (
    <div className={`hub-atmosphere hub-atmosphere--${savedTheme}`} aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="hub-atmosphere-particle"
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.duration,
            width: p.size,
            height: p.size,
            "--hub-atm-drift": `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
