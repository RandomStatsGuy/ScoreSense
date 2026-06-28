/** Team logos and headshot fallbacks for draft room. */

const TEAM_LOGO_ALIASES = {
  JAX: "jax",
  JAC: "jax",
  LA: "lar",
  LAR: "lar",
  WSH: "wsh",
  WAS: "wsh",
};

export function teamLogoUrl(team) {
  const abbr = String(team || "").trim().toUpperCase();
  if (!abbr) return null;
  const slug = TEAM_LOGO_ALIASES[abbr] || abbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`;
}

export function playerInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
