import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { apiFetch } from "./auth";
import { parseApiError } from "./format";
import { APPEARANCE_COPY } from "./themePresentation";
import { observeAppearanceReadiness } from "./appearanceReadiness";
import AtmosphereLayer from "./DraftHub/AtmosphereLayer";
import { applyAtmospherePatch, mergeAtmospherePrefs, serializeAtmospherePrefs } from "./DraftHub/atmosphereCatalog";

const AppearanceContext = createContext(null);
const appearanceStore = window.scoreSenseAppearance;
const subscribe = (listener) => appearanceStore.subscribe(listener);
const snapshot = () => appearanceStore.getSnapshot();

export function AppearanceProvider({ children }) {
  const { ready, authenticated, user } = useAuth();
  const raw = useSyncExternalStore(subscribe, snapshot, snapshot);
  const prefs = useMemo(() => mergeAtmospherePrefs(raw), [raw]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const pending = useRef(false);
  const accountKey = user?.id || user?.email || user?.name || "";

  // One prefs request for the app, never one per product tab or atmosphere layer.
  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    pending.current = false;
    setSaving(false);
    setMessage("");
    setError("");
    setLoadError("");
    if (!ready || !authenticated) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const beforeLoad = appearanceStore.getSnapshot();
    (async () => {
      try {
        const response = await apiFetch("/api/hub/prefs", { signal: controller.signal });
        if (!response.ok) throw new Error(await parseApiError(response));
        const data = await response.json();
        if (controller.signal.aborted || epoch.current !== generation) return;
        // Another tab may save a newer choice while this response is in flight.
        if (appearanceStore.getSnapshot() === beforeLoad) appearanceStore.set(serializeAtmospherePrefs(mergeAtmospherePrefs(data.prefs)));
      } catch (err) {
        if (!controller.signal.aborted && epoch.current === generation) setLoadError(err.message || APPEARANCE_COPY.loadFailed);
      } finally {
        if (!controller.signal.aborted && epoch.current === generation) setLoading(false);
      }
    })();
    return () => { controller.abort(); ++epoch.current; };
  }, [ready, authenticated, accountKey, retry]);

  const save = useCallback(async (patch) => {
    if (pending.current || loading || loadError || !authenticated) return;
    const generation = epoch.current;
    const previous = appearanceStore.getSnapshot();
    const optimistic = appearanceStore.set(serializeAtmospherePrefs(applyAtmospherePatch(mergeAtmospherePrefs(previous), patch)));
    pending.current = true;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch("/api/hub/prefs", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await parseApiError(response));
      const data = await response.json();
      if (epoch.current !== generation) return;
      if (appearanceStore.getSnapshot() === optimistic) appearanceStore.set(serializeAtmospherePrefs(mergeAtmospherePrefs(data.prefs)));
      setMessage(APPEARANCE_COPY.saved);
    } catch (err) {
      if (epoch.current !== generation) return;
      if (appearanceStore.getSnapshot() === optimistic) appearanceStore.set(previous);
      setError(err.message || APPEARANCE_COPY.failed);
    } finally {
      if (epoch.current === generation) { pending.current = false; setSaving(false); }
    }
  }, [authenticated, loading, loadError]);

  const value = useMemo(() => ({ prefs, save, loading, saving, message, error, loadError, retry: () => setRetry((n) => n + 1) }), [prefs, save, loading, saving, message, error, loadError]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export const useAppearance = () => useContext(AppearanceContext);

export function AppAppearanceLayer({ children }) {
  const { prefs, loading } = useAppearance();
  const { pathname, search } = useLocation();
  const routeKey = pathname + search;
  const contentMarker = useRef(null);
  const [readyRoute, setReadyRoute] = useState(null);
  const productPage = /^\/(projections|hub|tools)(\/|$)/.test(pathname) || pathname === "/account";
  const draftWorkspace = /^\/hub\/(draft|room)(\/|$)/.test(pathname) || /^\/tools\/mock-draft(\/|$)/.test(pathname);
  useLayoutEffect(() => {
    setReadyRoute(null);
    if (!productPage || draftWorkspace || loading) return undefined;
    return observeAppearanceReadiness(contentMarker.current.parentElement, (ready) => setReadyRoute(ready ? routeKey : null));
  }, [productPage, draftWorkspace, loading, routeKey]);
  if (!productPage) return children;
  return <>
    <AtmosphereLayer className="app-atmosphere" prefsOverride={prefs} liveDraft={draftWorkspace} fieldOnly />
    {children}
    <span hidden ref={contentMarker} />
    {!loading && readyRoute === routeKey && <AtmosphereLayer className="app-atmosphere-floor" prefsOverride={prefs} liveDraft={draftWorkspace} sceneOnly />}
  </>;
}
