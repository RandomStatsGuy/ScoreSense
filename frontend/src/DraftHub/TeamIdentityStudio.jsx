import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import confirmDialog from "../ui/confirm";
import {
  BANNER_LABELS,
  BANNER_PRESETS,
  MAX_LOCKER_PLAYERS,
  PHOTO_LABELS,
  PHOTO_PRESETS,
  identityMediaUrl,
  mergeFocus,
  mergeTeamIdentity,
} from "./atmosphereCatalog";
import IdentityCropMedia from "./IdentityCropMedia";
import LockerRoomScene from "./LockerRoomScene";
import TeamIdentityMark from "./TeamIdentityMark";
import TeamStadiumHero from "./TeamStadiumHero";
import { normalizeHubPosition } from "./hubPositions";

const TABS = [
  { id: "photo", label: "Photo" },
  { id: "banner", label: "Banner" },
  { id: "room", label: "Room" },
];

function revokeUrl(entry) {
  if (entry?.url) URL.revokeObjectURL(entry.url);
}

function replacePending(ref, setter, entry) {
  revokeUrl(ref.current);
  ref.current = entry;
  setter(entry);
}

function FocusSliders({ label, focus, onChange, disabled }) {
  const next = mergeFocus(focus);
  const set = (key, value) => onChange(mergeFocus({ ...next, [key]: Number(value) }));
  return (
    <div className="hub-look-sliders">
      <label className="hub-look-slider">
        <span>Horizontal</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={next.x}
          disabled={disabled}
          aria-label={`${label} horizontal position`}
          onChange={(e) => set("x", e.target.value)}
        />
      </label>
      <label className="hub-look-slider">
        <span>Vertical</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={next.y}
          disabled={disabled}
          aria-label={`${label} vertical position`}
          onChange={(e) => set("y", e.target.value)}
        />
      </label>
      <label className="hub-look-slider">
        <span>Zoom</span>
        <input
          type="range"
          min="1"
          max="2.5"
          step="0.05"
          value={next.zoom}
          disabled={disabled}
          aria-label={`${label} zoom`}
          onChange={(e) => set("zoom", e.target.value)}
        />
      </label>
    </div>
  );
}

export default function TeamIdentityStudio({
  open,
  onClose,
  leagueId,
  teamId,
  team,
  identity,
  roster = [],
  mediaById = {},
  onSaved,
}) {
  const [draft, setDraft] = useState(() => mergeTeamIdentity(identity));
  const [tab, setTab] = useState("photo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [pendingBanner, setPendingBanner] = useState(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [clearBanner, setClearBanner] = useState(false);
  const fileInputRef = useRef(null);
  const pendingPhotoRef = useRef(null);
  const pendingBannerRef = useRef(null);
  const titleRef = useRef(null);
  const requestCloseRef = useRef(null);
  const promptingRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    setDraft(mergeTeamIdentity(identity));
    setTab("photo");
    setBusy(false);
    setError("");
    setClearPhoto(false);
    setClearBanner(false);
    replacePending(pendingPhotoRef, setPendingPhoto, null);
    replacePending(pendingBannerRef, setPendingBanner, null);
    const onKey = (event) => {
      if (event.key === "Escape") requestCloseRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.cancelAnimationFrame(frame);
      revokeUrl(pendingPhotoRef.current);
      pendingPhotoRef.current = null;
      revokeUrl(pendingBannerRef.current);
      pendingBannerRef.current = null;
    };
  }, [open]); // identity is captured when the editor opens

  const activeRoster = useMemo(
    () => (roster || []).filter((r) => String(r.roster_status || "active") === "active"),
    [roster],
  );
  const selected = new Set(draft.locker_player_ids || []);

  const photoSrc = pendingPhoto?.url || (!clearPhoto ? identityMediaUrl(draft, "photo") : null);
  const bannerSrc = pendingBanner?.url || (!clearBanner ? identityMediaUrl(draft, "banner") : null);
  const previewLook = {
    ...draft,
    photo_url: photoSrc,
    banner_url: bannerSrc,
    photo_media_id: photoSrc ? draft.photo_media_id || "pending" : null,
    banner_media_id: bannerSrc ? draft.banner_media_id || "pending" : null,
  };

  const dirty = Boolean(
    pendingPhoto
    || pendingBanner
    || clearPhoto
    || clearBanner
    || JSON.stringify(mergeTeamIdentity(identity)) !== JSON.stringify(draft),
  );

  const requestClose = async () => {
    if (busy || promptingRef.current) return;
    if (dirty) {
      promptingRef.current = true;
      const discard = await confirmDialog({
        title: "Discard team look?",
        message: "You have unsaved photo, banner, or locker changes.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        danger: true,
      });
      promptingRef.current = false;
      if (!discard) return;
    }
    onClose?.();
  };
  requestCloseRef.current = requestClose;

  const stageFile = (kind, file) => {
    if (!file) return;
    const entry = { file, url: URL.createObjectURL(file) };
    if (kind === "photo") {
      replacePending(pendingPhotoRef, setPendingPhoto, entry);
      setClearPhoto(false);
      setDraft((prev) => ({ ...prev, photo_focus: mergeFocus({ x: 50, y: 50, zoom: 1 }) }));
    } else {
      replacePending(pendingBannerRef, setPendingBanner, entry);
      setClearBanner(false);
      setDraft((prev) => ({ ...prev, banner_focus: mergeFocus({ x: 50, y: 50, zoom: 1 }) }));
    }
  };

  const removeUpload = (kind) => {
    if (kind === "photo") {
      replacePending(pendingPhotoRef, setPendingPhoto, null);
      setClearPhoto(true);
    } else {
      replacePending(pendingBannerRef, setPendingBanner, null);
      setClearBanner(true);
    }
  };

  const uploadFile = async (kind, file) => {
    const form = new FormData();
    form.append("file", file);
    const res = await apiFetch(
      `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/identity/media?kind=${kind}&attach=false`,
      { method: "POST", body: form },
    );
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    return data.media;
  };

  const save = async () => {
    if (!leagueId || !teamId) return;
    setBusy(true);
    setError("");
    try {
      let photoId = clearPhoto ? null : (draft.photo_media_id || null);
      let bannerId = clearBanner ? null : (draft.banner_media_id || null);
      if (pendingPhoto) {
        const media = await uploadFile("photo", pendingPhoto.file);
        photoId = media.id;
      }
      if (pendingBanner) {
        const media = await uploadFile("banner", pendingBanner.file);
        bannerId = media.id;
      }
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/identity`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo_preset: draft.photo_preset,
            banner_preset: draft.banner_preset,
            photo_media_id: photoId,
            banner_media_id: bannerId,
            photo_focus: draft.photo_focus,
            banner_focus: draft.banner_focus,
            room_theme: draft.room_theme,
            locker_player_ids: draft.locker_player_ids,
          }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const next = mergeTeamIdentity(data.identity);
      setDraft(next);
      replacePending(pendingPhotoRef, setPendingPhoto, null);
      replacePending(pendingBannerRef, setPendingBanner, null);
      setClearPhoto(false);
      setClearBanner(false);
      onSaved?.(next);
      onClose?.();
    } catch (e) {
      setError(e.message || "Could not save team look");
    } finally {
      setBusy(false);
    }
  };

  const toggleLocker = (playerId) => {
    setDraft((prev) => {
      const next = new Set(prev.locker_player_ids || []);
      if (next.has(playerId)) next.delete(playerId);
      else if (next.size < MAX_LOCKER_PLAYERS) next.add(playerId);
      return { ...prev, locker_player_ids: Array.from(next) };
    });
  };

  if (!open || !leagueId || !teamId) return null;

  const cropKind = tab === "banner" ? "banner" : "photo";
  const cropSrc = cropKind === "banner" ? bannerSrc : photoSrc;
  const cropFocus = cropKind === "banner" ? draft.banner_focus : draft.photo_focus;
  const cropPreset = cropKind === "banner" ? draft.banner_preset : draft.photo_preset;

  return (
    <div
      className="hub-look-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className="hub-look-dialog panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hub-look-title"
      >
        <div className="hub-look-dialog-head">
          <div>
            <p className="hub-look-kicker">Team look</p>
            <h2 id="hub-look-title" className="hub-look-title" tabIndex={-1} ref={titleRef}>
              Edit team look
            </h2>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={requestClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="hub-look-tabs" role="tablist" aria-label="Team look sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`hub-look-tab${tab === item.id ? " is-active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "room" ? (
          <div className="hub-look-room">
            <p className="chart-note">
              Locker names stay on My team. Photo and banner still travel with the team everywhere else.
            </p>
            <div className="hub-identity-room-toggle">
              <button
                type="button"
                className={`filter-chip${draft.room_theme === "none" ? " filter-chip--active" : ""}`}
                aria-pressed={draft.room_theme === "none"}
                onClick={() => setDraft((prev) => ({ ...prev, room_theme: "none" }))}
              >
                Standard
              </button>
              <button
                type="button"
                className={`filter-chip${draft.room_theme === "locker" ? " filter-chip--active" : ""}`}
                aria-pressed={draft.room_theme === "locker"}
                onClick={() => setDraft((prev) => ({ ...prev, room_theme: "locker" }))}
              >
                Locker room
              </button>
            </div>
            {draft.room_theme === "locker" && (
              <>
                <p className="chart-note" id="hub-locker-help">
                  Choose up to {MAX_LOCKER_PLAYERS} players for locker nameplates. Lockers hang
                  in the order you pick them.
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
                        disabled={!on && selected.size >= MAX_LOCKER_PLAYERS}
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
                {(draft.locker_player_ids || []).length > 0 && (
                  <div className="hub-look-room-preview">
                    <p className="hub-look-side-label">Wall preview</p>
                    <LockerRoomScene
                      identity={draft}
                      roster={activeRoster}
                      mediaById={mediaById}
                      preview
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="hub-look-dialog-body">
            <section className="hub-look-crop-col">
              <div
                className={`hub-look-crop hub-look-crop--${cropKind} ${
                  cropKind === "banner" ? `hub-banner-fill--${cropPreset}` : `hub-team-photo--${cropPreset}`
                }`}
              >
                {cropSrc ? (
                  <IdentityCropMedia src={cropSrc} focus={cropFocus} />
                ) : (
                  <span className="hub-look-crop-empty">
                    {cropKind === "banner" ? "Preset banner" : "Preset photo"}
                  </span>
                )}
              </div>
              <p className="chart-note">
                {cropKind === "banner"
                  ? "This is the wide banner on My team."
                  : "This is how the photo appears next to your team name."}
              </p>
              <FocusSliders
                label={cropKind === "banner" ? "Banner" : "Photo"}
                focus={cropFocus}
                disabled={!cropSrc || busy}
                onChange={(next) => setDraft((prev) => (
                  cropKind === "banner"
                    ? { ...prev, banner_focus: next }
                    : { ...prev, photo_focus: next }
                ))}
              />
            </section>

            <aside className="hub-look-side">
              <div className="hub-look-previews">
                <p className="hub-look-side-label">Live previews</p>
                <div className="hub-look-preview-card">
                  <span>Compact</span>
                  <TeamIdentityMark team={team} identity={previewLook} size="sm" showName />
                </div>
                <div className="hub-look-preview-card">
                  <span>My team card</span>
                  <TeamStadiumHero
                    team={team}
                    identity={previewLook}
                    size="preview"
                    meta={`${activeRoster.length} player${activeRoster.length === 1 ? "" : "s"}`}
                  />
                </div>
                <div className="hub-look-preview-card">
                  <span>League switcher</span>
                  <TeamIdentityMark team={team} identity={previewLook} size="md" showName />
                </div>
              </div>

              <fieldset className="hub-identity-fieldset">
                <legend>{cropKind === "banner" ? "Banner presets" : "Photo presets"}</legend>
                <div className="hub-look-presets" role="radiogroup" aria-label={cropKind === "banner" ? "Banner preset" : "Photo preset"}>
                  {(cropKind === "banner" ? BANNER_PRESETS : PHOTO_PRESETS).map((id) => {
                    const active = cropKind === "banner" ? draft.banner_preset === id : draft.photo_preset === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`hub-look-preset ${
                          cropKind === "banner" ? `hub-banner-fill--${id}` : `hub-team-photo--${id}`
                        }${active ? " is-active" : ""}`}
                        aria-pressed={active}
                        onClick={() => setDraft((prev) => (
                          cropKind === "banner"
                            ? { ...prev, banner_preset: id }
                            : { ...prev, photo_preset: id }
                        ))}
                      >
                        {cropKind === "banner" ? BANNER_LABELS[id] : PHOTO_LABELS[id]}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="hub-look-upload-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    stageFile(cropKind, e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {cropKind === "banner" ? "Upload banner" : "Upload photo"}
                </button>
                {cropSrc ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => removeUpload(cropKind)}
                  >
                    {cropKind === "banner" ? "Remove banner" : "Remove photo"}
                  </button>
                ) : null}
              </div>
              <p className="chart-note">JPEG, PNG, or WebP. Under 2 MB. Nothing saves until you hit Save look.</p>
            </aside>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="hub-look-dialog-foot">
          <button type="button" className="btn-ghost" onClick={requestClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save look"}
          </button>
        </div>
      </div>
    </div>
  );
}
