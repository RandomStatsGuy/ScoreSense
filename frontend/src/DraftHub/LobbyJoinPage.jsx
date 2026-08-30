import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  apiFetch,
  getGuestSession,
  getToken,
  setGuestSession,
} from "../auth";
import { useAuth } from "../AuthContext";
import AccountAuth from "../AccountAuth";
import { PRODUCT_NAME } from "../brand";
import { parseApiError } from "../format";
import Button from "../ui/Button";
import { draftFormatLabel } from "./draftEntryStatus";
import { lobbyChipLabel } from "./draftLobby";
import { draftJoinAccountNote, draftJoinSupport } from "./leagueAccessCopy";
import DraftRoom from "./DraftRoom";
import { HubExperienceHero } from "./HubUILayout";

export default function LobbyJoinPage() {
  const { roomCode } = useParams();
  const { authenticated, termsUrl, privacyUrl, patreonConfigured } = useAuth();
  const [preview, setPreview] = useState(null);
  const [leagueId, setLeagueId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const code = String(roomCode || "").trim().toUpperCase();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/hub/lobby/${encodeURIComponent(code)}`);
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        if (cancelled) return;
        setPreview(data);
        const guest = getGuestSession();
        const alreadyGuest = guest?.league_id && guest.league_id === data.league_id;
        if (alreadyGuest) {
          setLeagueId(data.league_id);
        } else {
          const token = getToken();
          const room = await fetch(`/api/hub/league/${data.league_id}`, {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (room.ok) {
            const state = await room.json();
            if (state?.viewer?.team_id) setLeagueId(data.league_id);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Lobby not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const join = async (event) => {
    event?.preventDefault();
    setJoining(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/lobby/${encodeURIComponent(code)}/join`, {
        method: "POST",
        body: JSON.stringify({ display_name: name }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (data.token) {
        setGuestSession({
          token: data.token,
          leagueId: data.league_id,
          roomCode: data.room_code,
        });
      }
      setLeagueId(data.league_id);
      setPreview(data.lobby || preview);
    } catch (e) {
      setError(e.message || "Could not join this lobby");
    } finally {
      setJoining(false);
    }
  };

  if (leagueId) {
    return (
      <div className="draft-lobby-page">
        <DraftRoom
          leagueId={leagueId}
          toolMode
          guestMode={!authenticated}
          toolLabel={preview?.test_mode ? "Mock lobby" : "Draft lobby"}
          onExitRoom={() => setLeagueId("")}
          valueRows={[]}
          season={preview?.season}
        />
      </div>
    );
  }

  return (
    <div className="draft-lobby-page draft-lobby-join">
      <header className="draft-lobby-join-brand">
        <Link to="/projections/weekly">{PRODUCT_NAME}</Link>
      </header>
      {loading ? (
        <p className="chart-note">Opening the lobby…</p>
      ) : error && !preview ? (
        <div className="hub-experience-section">
          <h1>This lobby is gone.</h1>
          <p className="chart-note">{error}</p>
          <Link className="btn-ghost" to="/tools/mock-draft">Back to mock drafts</Link>
        </div>
      ) : (
        <>
          <HubExperienceHero
            eyebrow={preview?.test_mode ? "Practice draft" : "League draft"}
            heading={preview?.name || "Join this league"}
            support={draftJoinSupport({
              canJoin: preview?.can_join,
              leagueName: preview?.name,
              testMode: preview?.test_mode,
            })}
            chip={lobbyChipLabel({
              claimed: preview?.claimed,
              teamCount: preview?.team_count,
              live: !preview?.can_join && preview?.status !== "setup",
            })}
          />
          {error ? <p className="hub-alert hub-alert--danger" role="alert">{error}</p> : null}
          <div className="draft-lobby-join-grid">
            <section className="hub-experience-section">
              {preview?.can_join ? (
                <form onSubmit={join} className="draft-lobby-join-form">
                  <label htmlFor="lobby-join-name">Team name in this league</label>
                  <input
                    id="lobby-join-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={24}
                    autoComplete="nickname"
                    required
                  />
                  <Button type="submit" disabled={joining || !name.trim()}>
                    {joining ? "Joining…" : "Join this league's draft"}
                  </Button>
                  <p className="chart-note">{draftJoinAccountNote({ authenticated })}</p>
                </form>
                {!authenticated ? (
                  <details className="draft-lobby-join-account">
                    <summary>Create an account to keep this team after the draft</summary>
                    <p className="chart-note">
                      Optional. You can sit down now and make an account later.
                      Signing in first attaches this seat to your ScoreSense account.
                    </p>
                    <AccountAuth
                      compact
                      mode="register"
                      title="Create a ScoreSense account"
                      subtitle="Then join the draft with the name above."
                      termsUrl={termsUrl}
                      privacyUrl={privacyUrl}
                      patreonConfigured={patreonConfigured}
                      patreonNext={`/lobby/${code}`}
                      onAuthed={() => window.dispatchEvent(new Event("scoresense-auth-changed"))}
                    />
                  </details>
                ) : null}
              ) : (
                <p className="chart-note">Ask the host for a new link if you still need a seat.</p>
              )}
            </section>
            <aside className="hub-experience-section draft-lobby-join-meta" aria-label="Room details">
              <dl>
                <div>
                  <dt>Format</dt>
                  <dd>{draftFormatLabel({ draft_type: preview?.draft_type })}</dd>
                </div>
                <div>
                  <dt>Seated</dt>
                  <dd>{preview?.claimed || 0} / {preview?.team_count || 12}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
