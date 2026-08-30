import React, { useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import HubMediaImg from "./HubMediaImg";
import {
  BANNER_PRESETS,
  MAX_LOCKER_PLAYERS,
  PHOTO_PRESETS,
  mergeTeamIdentity,
} from "./atmosphereCatalog";
import { normalizeHubPosition } from "./hubPositions";

const PHOTO_LABELS = {
  gridiron: "Gridiron",
  tunnel: "Tunnel",
  night: "Night kickoff",
  turf: "Turf",
  storm: "Storm",
  locker_lights: "Locker lights",
};

const BANNER_LABELS = {
  navy_stripe: "Navy stripe",
  teal_fade: "Teal fade",
  amber_edge: "Amber edge",
  home_white: "Home white",
  away_slate: "Away slate",
  championship: "Championship",
};

export default function TeamIdentityStudio({
  leagueId,
  teamId,
  identity,
  roster = [],
  onSaved,
}) {
  const [draft, setDraft] = useState(() => mergeTeamIdentity(identity));
  const [busy, setBusy] = useState(false);
  const [uploadKind, setUploadKind] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(mergeTeamIdentity(identity));
  }, [identity]);

  if (!leagueId || !teamId) return null;

  const activeRoster = (roster || []).filter((r) => String(r.roster_status || "active") === "active");
  const selected = new Set(draft.locker_player_ids || []);

  const patch = async (body) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/identity`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const next = mergeTeamIdentity(data.identity);
      setDraft(next);
      onSaved?.(next);
      setMessage("Team look saved.");
    } catch (e) {
      setError(e.message || "Could not save team look");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (kind, file) => {
    if (!file) return;
    setUploadKind(kind);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/identity/media?kind=${kind}`,
        { method: "POST", body: form },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const next = mergeTeamIdentity(data.identity);
      setDraft(next);
      onSaved?.(next);
      setMessage(kind === "banner" ? "Banner uploaded." : "Photo uploaded.");
    } catch (e) {
      setError(e.message || "Could not upload image");
    } finally {
      setUploadKind("");
    }
  };

  const toggleLocker = (playerId) => {
    const next = new Set(selected);
    if (next.has(playerId)) next.delete(playerId);
    else if (next.size < MAX_LOCKER_PLAYERS) next.add(playerId);
    const ids = Array.from(next);
    setDraft((prev) => ({ ...prev, locker_player_ids: ids }));
    patch({ locker_player_ids: ids });
  };

  const photoUrl = draft.photo_url || (draft.photo_media_id ? `/api/hub/media/${draft.photo_media_id}` : null);
  const bannerUrl = draft.banner_url || (draft.banner_media_id ? `/api/hub/media/${draft.banner_media_id}` : null);

  return (
    <details className="hub-identity-studio">
      <summary>Team look</summary>
      <div className="hub-identity-studio-body">
        <p className="chart-note">
          A photo and banner travel with your team wherever it appears. Locker names stay on My team.
        </p>

        <div
          className={`hub-identity-preview hub-team-photo--${draft.photo_preset} hub-team-banner--${draft.banner_preset}`}
          aria-hidden="true"
        >
          {bannerUrl ? <HubMediaImg src={bannerUrl} alt="" className="hub-identity-preview-banner" /> : null}
          {photoUrl ? <HubMediaImg src={photoUrl} alt="" className="hub-identity-preview-photo" /> : null}
        </div>

        <fieldset className="hub-identity-fieldset">
          <legend>Photo</legend>
          <div className="hub-identity-swatches" role="radiogroup" aria-label="Team photo preset">
            {PHOTO_PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                className={`hub-identity-swatch hub-team-photo--${id}${draft.photo_preset === id ? " is-active" : ""}`}
                aria-pressed={draft.photo_preset === id}
                onClick={() => patch({ photo_preset: id })}
                disabled={busy}
              >
                {PHOTO_LABELS[id]}
              </button>
            ))}
          </div>
          <label className="hub-identity-upload">
            <span className="hub-field-label">Or upload a photo</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={Boolean(uploadKind)}
              onChange={(e) => upload("photo", e.target.files?.[0])}
            />
          </label>
        </fieldset>

        <fieldset className="hub-identity-fieldset">
          <legend>Banner</legend>
          <div className="hub-identity-swatches" role="radiogroup" aria-label="Team banner preset">
            {BANNER_PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                className={`hub-identity-swatch hub-team-banner--${id}${draft.banner_preset === id ? " is-active" : ""}`}
                aria-pressed={draft.banner_preset === id}
                onClick={() => patch({ banner_preset: id })}
                disabled={busy}
              >
                {BANNER_LABELS[id]}
              </button>
            ))}
          </div>
          <label className="hub-identity-upload">
            <span className="hub-field-label">Or upload a banner</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={Boolean(uploadKind)}
              onChange={(e) => upload("banner", e.target.files?.[0])}
            />
          </label>
        </fieldset>

        <fieldset className="hub-identity-fieldset">
          <legend>My team room</legend>
          <div className="hub-identity-room-toggle">
            <button
              type="button"
              className={`filter-chip${draft.room_theme === "none" ? " filter-chip--active" : ""}`}
              aria-pressed={draft.room_theme === "none"}
              onClick={() => patch({ room_theme: "none" })}
              disabled={busy}
            >
              Standard
            </button>
            <button
              type="button"
              className={`filter-chip${draft.room_theme === "locker" ? " filter-chip--active" : ""}`}
              aria-pressed={draft.room_theme === "locker"}
              onClick={() => patch({ room_theme: "locker" })}
              disabled={busy}
            >
              Locker room
            </button>
          </div>
          {draft.room_theme === "locker" && (
            <>
              <p className="chart-note" id="hub-locker-help">
                Choose up to {MAX_LOCKER_PLAYERS} players for locker nameplates.
              </p>
              <div className="hub-identity-lockers" role="group" aria-describedby="hub-locker-help">
                {activeRoster.map((row) => {
                  const on = selected.has(row.player_id);
                  return (
                    <button
                      key={row.player_id}
                      type="button"
                      className={`hub-identity-locker-pick${on ? " is-active" : ""}`}
                      aria-pressed={on}
                      disabled={busy || (!on && selected.size >= MAX_LOCKER_PLAYERS)}
                      onClick={() => toggleLocker(row.player_id)}
                    >
                      <strong>{row.player_name}</strong>
                      <span>{normalizeHubPosition(row.position) || row.position}</span>
                    </button>
                  );
                })}
                {!activeRoster.length && (
                  <p className="chart-note">Add players before assigning lockers.</p>
                )}
              </div>
            </>
          )}
        </fieldset>

        {message && <p className="chart-note" role="status">{message}</p>}
        {error && <div className="error">{error}</div>}
        {uploadKind && <p className="chart-note">Uploading {uploadKind}…</p>}
      </div>
    </details>
  );
}
