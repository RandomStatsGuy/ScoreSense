import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "../auth";
import { parseApiError, connectionErrorMessage } from "../format";
import { isAbortError } from "../fetchAbort";
import useAsyncActionScope from "../ui/useAsyncActionScope";
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
  const requestVersion = useRef(0);
  const context = hubContext || (discovered && discovered.identity === identity ? discovered.context : null);
  const leagueId = enabled && context?.mode === "league" && !context?.demo ? context.league_id : null;
  const key = `${identity || "dev"}:${leagueId || ""}:${context?.team_id || ""}`;
  const operationKey=JSON.stringify([key,Boolean(enabled)]);
  const captureScope=useAsyncActionScope(operationKey);
  const pendingPreferences=useRef(null);
  const data = snapshot.key === key ? snapshot.data : EMPTY;
  const ready = snapshot.key === key;
  const base = leagueId ? `/api/hub/league/${encodeURIComponent(leagueId)}` : null;

  useEffect(() => {
    if (!enabled || hubContext) { setDiscovered(null); return undefined; }
    const controller = new AbortController();
    chatRequest("/api/hub/context", {signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setDiscovered({identity,context:data});}).catch(() => {});
    return () => controller.abort();
  }, [enabled, hubContext, identity]);

  useEffect(() => { pendingPreferences.current=null; seen.current=null; setScene(null); setToast(null); setError(""); setSaving(false); }, [operationKey]);
  useEffect(() => {
    if(enabled && ready && new URLSearchParams(location.search).get('notifications')==='settings')setScene('settings');
  }, [enabled, ready, key, location.search]);

  const refresh = useCallback(async (signal) => {
    if (!enabled) return;
    const version=++requestVersion.current;
    const isCurrent=captureScope();
    try {
      const next = await chatRequest(base ? `${base}/chat/summary` : "/api/hub/notifications/preferences", {signal});
      if (signal?.aborted || !isCurrent() || version!==requestVersion.current) return;
      let value = base ? next : {...EMPTY, preferences:next.preferences};
      const pending=pendingPreferences.current;
      if(pending?.key===key&&pending.isCurrent())value={...value,preferences:{...value.preferences,...pending.patch}};
      if (seen.current) {
        const incoming = incomingSiteAlerts(value.notifications, seen.current, value.preferences);
        if (!document.hidden && incoming.length) setToast(incoming[0]);
      }
      seen.current=new Set(value.notifications.map(item=>item.id));
      setSnapshot({key, data:value}); setError("");
    } catch (e) {
      if (!isAbortError(e) && !signal?.aborted && isCurrent() && version===requestVersion.current) setError(connectionErrorMessage(e));
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
    if(!enabled||pendingPreferences.current?.isCurrent())return;
    const isCurrent=captureScope();
    pendingPreferences.current={key,patch,isCurrent};
    const previous=data.preferences;
    requestVersion.current++;
    setSnapshot(prev=>({key,data:{...(prev.key===key?prev.data:EMPTY),preferences:{...previous,...patch}}}));
    setSaving(true); setError("");
    try {
      const response=await chatRequest("/api/hub/notifications/preferences",jsonRequest({preferences:patch},"PUT"));
      if(isCurrent()) { pendingPreferences.current=null; requestVersion.current++; seen.current=null; setSnapshot(prev=>({key,data:{...(prev.key===key?prev.data:EMPTY),preferences:response.preferences}})); await refresh(); }
    } catch(e) { if(isCurrent()) { pendingPreferences.current=null; setSnapshot(prev=>({...prev,data:{...prev.data,preferences:previous}})); setError(connectionErrorMessage(e)); } }
    finally { if(isCurrent()) setSaving(false); }
  }, [key, enabled, data.preferences, refresh, captureScope]);
  const readAlerts = useCallback(async (ids, through=null) => {
    if(!enabled||!base || (!ids.length&&!through)) return;
    const isCurrent=captureScope();
    try { await chatRequest(`${base}/notifications/read`,jsonRequest({ids,through})); if(isCurrent())await refresh(); }
    catch(e) { if(isCurrent())setError(connectionErrorMessage(e)); }
  }, [base, enabled, refresh, key, captureScope]);
  const openNotification = useCallback(async item => {
    const isCurrent=captureScope();
    await readAlerts([item.id]);
    if(!isCurrent())return;
    setToast(null);
    if(item.target?.view==='trades') { setScene(null); navigate('/hub/trades'); }
    else openChat(item.target?.thread || 'league');
  }, [readAlerts, navigate, openChat, key]);
  const value=useMemo(()=>({enabled, context, leagueId, scopeKey:key, base, data, scene, setScene, thread, setThread,
    dismissed, setBubble, toast, setToast, error, saving, refresh, openChat, savePreferences, readAlerts, openNotification}),
    [enabled, context, leagueId, key, base, data, scene, thread, dismissed, setBubble, toast, error, saving, refresh, openChat, savePreferences, readAlerts, openNotification]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
