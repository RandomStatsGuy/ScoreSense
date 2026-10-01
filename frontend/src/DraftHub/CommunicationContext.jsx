import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../auth";
import { parseApiError, connectionErrorMessage } from "../format";
import { isAbortError } from "../fetchAbort";
import { chatPollMs, incomingSiteAlerts, readChatLauncherDismissed, writeChatLauncherDismissed } from "./fantasyChatPresentation";

const Context = createContext(null);
const EMPTY = {threads:[], members:[], notifications:[], unread:0, notification_unread:0, preferences:{}};
export async function chatRequest(path, options) {
  const response = await apiFetch(path, options);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}
export function jsonRequest(body, method="POST") {
  return {method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)};
}
export function useCommunication() { return useContext(Context); }

export function CommunicationProvider({ children, hubContext, enabled, identity }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [discovered, setDiscovered] = useState(null);
  const [snapshot, setSnapshot] = useState({key:"", data:EMPTY});
  const [scene, setScene] = useState(null);
  const [thread, setThread] = useState("league");
  const [dismissed, setDismissed] = useState(readChatLauncherDismissed);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const seen = useRef(null);
  const currentKey = useRef("");
  const requestVersion = useRef(0);
  const context = hubContext || discovered;
  const leagueId = enabled && context?.mode === "league" && !context?.demo ? context.league_id : null;
  const key = `${identity || "dev"}:${leagueId || ""}:${context?.team_id || ""}`;
  currentKey.current = key;
  const data = snapshot.key === key ? snapshot.data : EMPTY;
  const ready = snapshot.key === key;
  const base = leagueId ? `/api/hub/league/${encodeURIComponent(leagueId)}` : null;

  useEffect(() => {
    if (!enabled || hubContext) { setDiscovered(null); return undefined; }
    const controller = new AbortController();
    chatRequest("/api/hub/context", {signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setDiscovered(data);}).catch(() => {});
    return () => controller.abort();
  }, [enabled, hubContext, identity]);

  useEffect(() => { seen.current=null; setScene(null); setToast(null); setError(""); setSaving(false); }, [key]);
  useEffect(() => {
    if(enabled && ready && new URLSearchParams(location.search).get('notifications')==='settings')setScene('settings');
  }, [enabled, ready, key, location.search]);

  const refresh = useCallback(async (signal) => {
    if (!enabled) return;
    const version=++requestVersion.current;
    try {
      const next = await chatRequest(base ? `${base}/chat/summary` : "/api/hub/notifications/preferences", {signal});
      if (signal?.aborted || currentKey.current !== key || version!==requestVersion.current) return;
      const value = base ? next : {...EMPTY, preferences:next.preferences};
      if (seen.current) {
        const incoming = incomingSiteAlerts(value.notifications, seen.current, value.preferences);
        if (!document.hidden && incoming.length) setToast(incoming[0]);
      }
      seen.current=new Set(value.notifications.map(item=>item.id));
      setSnapshot({key, data:value}); setError("");
    } catch (e) {
      if (!isAbortError(e) && !signal?.aborted && currentKey.current === key && version===requestVersion.current) setError(connectionErrorMessage(e));
    }
  }, [enabled, base, key]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let timer, generation=0;
    const tick = async () => {
      const run=++generation;
      if (!document.hidden) await refresh(controller.signal);
      if (!controller.signal.aborted && run===generation) timer=setTimeout(tick, chatPollMs({hidden:document.hidden}));
    };
    const visibility = () => { clearTimeout(timer); tick(); };
    tick(); document.addEventListener("visibilitychange",visibility);
    return () => { controller.abort(); generation++; clearTimeout(timer); document.removeEventListener("visibilitychange",visibility); };
  }, [enabled, refresh]);

  const openChat = useCallback((next="league") => { setThread(next); setScene("chat"); setToast(null); }, []);
  const setBubble = useCallback((hidden) => { setDismissed(writeChatLauncherDismissed(hidden)); }, []);
  const savePreferences = useCallback(async (patch) => {
    const previous=data.preferences;
    requestVersion.current++;
    setSnapshot(prev=>({key,data:{...(prev.key===key?prev.data:EMPTY),preferences:{...previous,...patch}}}));
    setSaving(true); setError("");
    try {
      const response=await chatRequest("/api/hub/notifications/preferences",jsonRequest({preferences:patch},"PUT"));
      if(currentKey.current===key) { requestVersion.current++; seen.current=null; setSnapshot(prev=>({key,data:{...(prev.key===key?prev.data:EMPTY),preferences:response.preferences}})); await refresh(); }
    } catch(e) { if(currentKey.current===key) { setSnapshot(prev=>({...prev,data:{...prev.data,preferences:previous}})); setError(connectionErrorMessage(e)); } }
    finally { if(currentKey.current===key) setSaving(false); }
  }, [key, data.preferences, refresh]);
  const readAlerts = useCallback(async (ids, through=null) => {
    if(!base || (!ids.length&&!through)) return;
    try { await chatRequest(`${base}/notifications/read`,jsonRequest({ids,through})); if(currentKey.current===key)await refresh(); }
    catch(e) { if(currentKey.current===key)setError(connectionErrorMessage(e)); }
  }, [base, refresh, key]);
  const openNotification = useCallback(async item => {
    await readAlerts([item.id]); setToast(null);
    if(currentKey.current!==key)return;
    if(item.target?.view==='trades') { setScene(null); navigate('/hub/trades'); }
    else openChat(item.target?.thread || 'league');
  }, [readAlerts, navigate, openChat, key]);
  const value=useMemo(()=>({enabled, context, leagueId, scopeKey:key, base, data, scene, setScene, thread, setThread,
    dismissed, setBubble, toast, setToast, error, saving, refresh, openChat, savePreferences, readAlerts, openNotification}),
    [enabled, context, leagueId, key, base, data, scene, thread, dismissed, setBubble, toast, error, saving, refresh, openChat, savePreferences, readAlerts, openNotification]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
