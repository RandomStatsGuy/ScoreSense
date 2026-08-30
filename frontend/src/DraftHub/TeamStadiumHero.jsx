import React from "react";
import IdentityCropMedia from "./IdentityCropMedia";
import { identityMediaUrl, initialsFromName, mergeTeamIdentity } from "./atmosphereCatalog";
import { hubTeamLabel } from "./hubTeamLabel";

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
  const photoUrl = identityMediaUrl(look, "photo");
  const bannerUrl = identityMediaUrl(look, "banner");
  const preview = size === "preview";

  return (
    <article
      className={`hub-stadium-hero${preview ? " hub-stadium-hero--preview" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className={`hub-stadium-hero-banner hub-banner-fill--${look.banner_preset}`}>
        {bannerUrl ? (
          <IdentityCropMedia src={bannerUrl} focus={look.banner_focus} className="hub-stadium-hero-banner-img" />
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
            <IdentityCropMedia src={photoUrl} focus={look.photo_focus} />
          ) : (
            <span className="hub-team-mark-initials">{initialsFromName(name)}</span>
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
