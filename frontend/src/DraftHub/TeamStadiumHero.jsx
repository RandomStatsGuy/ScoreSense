import React from "react";
import IdentityCropMedia from "./IdentityCropMedia";
import {
  HUB_MEDIA_HERO_WIDTH,
  HUB_MEDIA_MARK_WIDTH,
  identityMediaUrl,
  initialsFromName,
  mergeTeamIdentity,
} from "./atmosphereCatalog";
import { hubTeamInitialsName, hubTeamLabel } from "./hubTeamLabel";

export default function TeamStadiumHero({
  team,
  identity,
  meta,
  cap,
  chips,
  onEdit,
  size = "full",
  className = "",
}) {
  const look = mergeTeamIdentity(identity);
  const name = hubTeamLabel(team) || team?.name || "Team";
  const initialsName = hubTeamInitialsName(team) || team?.name || "Team";
  const preview = size === "preview";
  const paintWidth = preview ? HUB_MEDIA_MARK_WIDTH : HUB_MEDIA_HERO_WIDTH;
  const photoUrl = identityMediaUrl(look, "photo", { width: paintWidth });
  const bannerUrl = identityMediaUrl(look, "banner", { width: paintWidth });

  return (
    <article
      className={`hub-stadium-hero${preview ? " hub-stadium-hero--preview" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className={`hub-stadium-hero-banner hub-banner-fill--${look.banner_preset}`}>
        {bannerUrl ? (
          <IdentityCropMedia src={bannerUrl} focus={look.banner_focus} className="hub-stadium-hero-banner-img" width={paintWidth} />
        ) : null}
        {onEdit ? (
          <button type="button" className="hub-stadium-hero-edit" onClick={onEdit}>
            Edit look
          </button>
        ) : null}
      </div>
      <div className="hub-stadium-hero-body">
        <div
          className={`hub-stadium-hero-photo hub-team-photo--${look.photo_preset}`}
          aria-hidden="true"
        >
          {photoUrl ? (
            <IdentityCropMedia src={photoUrl} focus={look.photo_focus} width={paintWidth} />
          ) : (
            <span className="hub-team-mark-initials">{initialsFromName(initialsName)}</span>
          )}
        </div>
        <div className="hub-stadium-hero-id">
          <div className="hub-stadium-hero-name">{name}</div>
          {meta ? <div className="hub-stadium-hero-meta">{meta}</div> : null}
        </div>
        {cap ? <div className="hub-stadium-hero-cap">{cap}</div> : null}
      </div>
      {chips ? <div className="hub-stadium-hero-chips">{chips}</div> : null}
    </article>
  );
}
