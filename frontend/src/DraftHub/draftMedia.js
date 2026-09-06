/** Team logos and headshot fallbacks for draft room. */

import { snapHubMediaWidth, withHubMediaWidth } from "./atmosphereCatalog.js";

const TEAM_LOGO_ALIASES = {
  JAX: "jax",
  JAC: "jax",
  LA: "lar",
  LAR: "lar",
  WSH: "wsh",
  WAS: "wsh",
};

export const PAINT_WIDTH = Object.freeze({
  avatar: 48,
  mark: 96,
  hero: 256,
});

export function paintMediaUrl(url, width) {
  if (!url) return url;
  const href = String(url);
  const snapped = snapHubMediaWidth(width);
  if (!snapped) return href;
  if (href.includes("/api/hub/media/")) return withHubMediaWidth(href, snapped);
  if (href.includes("espncdn.com")) return espnPaintUrl(href, snapped);
  if (href.includes("sleepercdn.com")) return sleeperPaintUrl(href, snapped);
  return href;
}

function espnPaintUrl(href, width) {
  if (href.includes("combiner/i?")) {
    const next = href
      .replace(/([?&])w=\d+/g, "$1")
      .replace(/([?&])h=\d+/g, "$1")
      .replace(/[?&]$/, "")
      .replace(/\?&/, "?");
    return `${next}${next.includes("?") ? "&" : "?"}w=${width}&h=${width}`;
  }
  let path = href.replace(/^https?:\/\/[^/]+/i, "");
  const q = path.indexOf("?");
  if (q >= 0) path = path.slice(0, q);
  return `https://a.espncdn.com/combiner/i?img=${path}&w=${width}&h=${width}`;
}

function sleeperPaintUrl(href, width) {
  if (width > 96) return href;
  if (href.includes("/players/thumb/")) return href;
  return href.replace("/content/nfl/players/", "/content/nfl/players/thumb/");
}

export function teamLogoUrl(team, { width } = {}) {
  const abbr = String(team || "").trim().toUpperCase();
  if (!abbr) return null;
  const slug = TEAM_LOGO_ALIASES[abbr] || abbr.toLowerCase();
  const url = `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`;
  return width ? paintMediaUrl(url, width) : url;
}

export function playerInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function playerFaceInitials(player, empty = "?") {
  if (!player) return empty;
  return playerInitials(player.player_name || player.player_id || "");
}

export function lookupPlayerMedia(media, playerId) {
  if (!media || playerId == null || playerId === "") return null;
  return media[playerId] || media[String(playerId)] || null;
}

export function headshotCandidates(media = {}, extraUrls = [], { width } = {}) {
  const shots = [
    media?.headshot_url,
    media?.espn_headshot_url,
    ...extraUrls,
  ].filter(Boolean);
  return width ? shots.map((url) => paintMediaUrl(url, width)) : shots;
}
