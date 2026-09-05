import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, getToken } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { confirmDialog } from "../ui/confirm";
import { HubFilterChip } from "./HubUILayout";
import { HOME_DECK_COPY } from "./leagueHomePresentation";
import { chatPollMs } from "./fantasyChatPresentation";

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function LeagueChat({ leagueId, hubContext, compact = false, lockedKind = null }) {
  const isStaff = Boolean(hubContext?.is_commissioner);
  const isPrimary = Boolean(hubContext?.is_primary_commissioner);
  const [kind, setKind] = useState(lockedKind || "league");
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const myTeamId = hubContext?.team_id || null;

  const load = useCallback(async () => {
    if (!leagueId) return;
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/chat/${encodeURIComponent(kind)}/messages?limit=80`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMessages(data.messages || []);
      setError("");
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId, kind]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (lockedKind) {
      setKind(lockedKind);
      return;
    }
    if (!isStaff && kind === "office") setKind("league");
  }, [isStaff, kind, lockedKind]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, kind]);

  // Poll + optional WS for live updates. Hidden tabs back off so battery and
  // "network quiet" are not a 12s loop on every Fantasy page.
  useEffect(() => {
    if (!leagueId) return undefined;
    let timer;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    };
    const arm = () => {
      if (timer) clearInterval(timer);
      const hidden = typeof document !== "undefined" && document.hidden;
      timer = setInterval(tick, chatPollMs({ compact, hidden }));
    };
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) load();
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);

    if (compact) {
      // Live draft already holds /api/hub/ws/{id}. A second socket to the same
      // path makes proxies drop the room connection and the UI flickers.
      return () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }

    let ws;
    try {
      const token = typeof getToken === "function" ? getToken() : null;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const qs = token ? `?token=${encodeURIComponent(token)}` : "";
      ws = new WebSocket(`${proto}://${window.location.host}/api/hub/ws/${leagueId}${qs}`);
      ws.onmessage = (ev) => {
        try {
          const payload = JSON.parse(ev.data);
          if (payload?.type === "chat_cleared" && payload.kind === kind) {
            setMessages([]);
            return;
          }
          if (payload?.type === "chat" && payload.kind === kind && payload.message) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.message.id)) return prev;
              return [...prev, payload.message];
            });
          }
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* polling only */
    }

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [leagueId, kind, load, compact]);

  const send = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/chat/${encodeURIComponent(kind)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (data.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      }
      setBody("");
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const clearChat = async () => {
    if (!leagueId || !isPrimary || clearing) return;
    const label = kind === "office" ? "Staff" : "League";
    if (!(await confirmDialog({
      title: `Clear ${label} chat`,
      message: `Delete all messages in ${label} chat? This cannot be undone.`,
      confirmLabel: "Clear chat",
      danger: true,
    }))) return;
    setClearing(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/chat/${encodeURIComponent(kind)}/messages`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setMessages([]);
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className={`hub-league-chat${compact ? " hub-league-chat--compact" : ""}`}>
      {!compact && (
      <div className="hub-filter-bar hub-league-chat-channels">
        <HubFilterChip active={kind === "league"} onClick={() => setKind("league")}>
          League
        </HubFilterChip>
        {isStaff && (
          <HubFilterChip active={kind === "office"} onClick={() => setKind("office")}>
            Staff
          </HubFilterChip>
        )}
        <span className="table-meta">
          {kind === "office"
            ? "Commissioners only"
            : "Visible to every team in the league"}
        </span>
      </div>
      )}
      {compact && (
        <div className="hub-league-chat-compact-head">
          <strong>Draft chat</strong>
          <span className="chart-note">League</span>
        </div>
      )}
      {isPrimary && !compact && (
        <div className="hub-league-chat-staff">
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={clearChat}
            disabled={clearing || loading || messages.length === 0}
            title={messages.length === 0 ? "Nothing to clear" : "Delete all messages in this channel"}
          >
            {clearing ? "Clearing…" : HOME_DECK_COPY.clearChat}
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {loading && <p className="chart-note">Loading messages…</p>}

      <div className="hub-league-chat-list" ref={listRef} role="log" aria-live="polite">
        {!loading && messages.length === 0 && (
          <p className="chart-note">No messages yet — say hello.</p>
        )}
        {messages.map((m) => {
          const mine = myTeamId && m.team_id === myTeamId;
          return (
            <div
              key={m.id}
              className={`hub-league-chat-msg${mine ? " is-mine" : ""}`}
            >
              <div className="hub-league-chat-msg-meta">
                <strong>{m.team_name || "Manager"}</strong>
                <span>{formatTime(m.created_at)}</span>
              </div>
              <div className="hub-league-chat-msg-body">{m.body}</div>
            </div>
          );
        })}
      </div>

      <form className="hub-league-chat-compose" onSubmit={send}>
        <input
          type="text"
          className="search-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={kind === "office" ? "Message commissioners…" : "Message the league…"}
          maxLength={2000}
          aria-label="Chat message"
        />
        <button type="submit" className="btn-ghost btn-sm" disabled={sending || !body.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}
