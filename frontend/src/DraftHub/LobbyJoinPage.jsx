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
import {
  draftJoinAccountNote,
  draftJoinSupport,
  liveDraftMembersOnlyMessage,
} from "./leagueAccessCopy";
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
  const membersOnly = Boolean(preview && !preview.test_mode);
  const canWalkIn = Boolean(preview?.test_mode && (preview.can_walk_in ?? preview.can_join));

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
        if (alreadyGuest && data.test_mode) {
          setLeagueId(data.league_id);
        } else {
          const token = getToken();
          const room = await fetch(`/api/hub/league/${data.league_id}`, {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (room.ok) {
            const state = await room.json();
            if (state?.viewer?.team_id && !state?.viewer?.is_guest) {
              setLeagueId(data.league_id);
            } else if (state?.viewer?.team_id && data.test_mode) {
              setLeagueId(data.league_id);
            }
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Lobby not found");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code, authenticated]);

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
          guestMode={!authenticated && Boolean(preview?.test_mode)}
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
            heading={preview?.name || (membersOnly ? "Members only" : "Join this league")}
            support={draftJoinSupport({
              canJoin: preview?.can_join,
              leagueName: preview?.name,
              testMode: preview?.test_mode,
              membersOnly,
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
              {canWalkIn ? (
                <>
                  <form onSubmit={join} className="draft-lobby-join-form">
                    <label htmlFor="lobby-join-name">Your name in this room</label>
                    <input
                      id="lobby-join-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={24}
                      autoComplete="nickname"
                      required
                    />
                    <Button type="submit" disabled={joining || !name.trim()}>
                      {joining ? "Joining…" : "Take a seat"}
                    </Button>
                    <p className="chart-note">{draftJoinAccountNote({ authenticated })}</p>
                  </form>
                </>
              ) : membersOnly ? (
                <div className="draft-lobby-join-form">
                  <p className="chart-note">{liveDraftMembersOnlyMessage()}</p>
                  <p className="chart-note">{draftJoinAccountNote({ authenticated, membersOnly: true })}</p>
                  {!authenticated ? (
                    <AccountAuth
                      compact
                      mode="login"
                      title="Sign in to enter the draft"
                      subtitle="Use the account that already has a team in this league."
                      termsUrl={termsUrl}
                      privacyUrl={privacyUrl}
                      patreonConfigured={patreonConfigured}
                      patreonNext={`/lobby/${code}`}
                      onAuthed={() => window.dispatchEvent(new Event("scoresense-auth-changed"))}
                    />
                  ) : (
                    <p className="chart-note">
                      This account is not on the league yet.
                      {" "}
                      <Link to="/hub/setup">Open league connections</Link>
                      {" "}
                      to join with a room code, or ask your commissioner for an email invite.
                    </p>
                  )}
                </div>
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
