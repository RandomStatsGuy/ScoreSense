import React from "react";
import { identityMediaUrl } from "./atmosphereCatalog";
import IdentityCropMedia from "./IdentityCropMedia";
import "../styles/matchup-banner-art.css";

/** Shared faded artwork for the private team room and Game center scoreboards. */
export default function MatchupBannerArt({ identity, side = "home" }) {
  const src = identityMediaUrl(identity, "banner");
  return src ? (
    <div className={`matchup-banner-art matchup-banner-art--${side}`} aria-hidden="true">
      <IdentityCropMedia key={src} src={src} focus={identity?.banner_focus} alt="" />
    </div>
  ) : null;
}
