/** Named bot seats — locker marks plus a bidding personality. */

export const BOT_PERSONAS = Object.freeze([
  {
    id: "auditor",
    name: "The Auditor",
    nato: "Bot Alpha",
    hint: "Never overpays",
    initials: "AU",
    photoPreset: "locker_lights",
    bannerPreset: "teal_fade",
    ceilMin: 0.75,
    ceilMax: 0.9,
    jumpMult: 0.75,
    minJump: null,
    luxuryMult: 0.55,
  },
  {
    id: "whale",
    name: "Whale",
    nato: "Bot Bravo",
    hint: "Jumps +$10",
    initials: "WH",
    photoPreset: "night",
    bannerPreset: "championship",
    ceilMin: 1.08,
    ceilMax: 1.22,
    jumpMult: 1.55,
    minJump: 10,
    luxuryMult: 0.9,
  },
  {
    id: "scout",
    name: "The Scout",
    nato: "Bot Charlie",
    hint: "Pays for upside",
    initials: "SC",
    photoPreset: "turf",
    bannerPreset: "amber_edge",
    ceilMin: 0.88,
    ceilMax: 1.12,
    jumpMult: 1.1,
    minJump: null,
    luxuryMult: 0.75,
  },
  {
    id: "needler",
    name: "The Needler",
    nato: "Bot Delta",
    hint: "Fills holes at fair",
    initials: "ND",
    photoPreset: "gridiron",
    bannerPreset: "navy_stripe",
    ceilMin: 0.95,
    ceilMax: 1.05,
    jumpMult: 1,
    minJump: null,
    luxuryMult: 0.5,
  },
  {
    id: "sniper",
    name: "The Sniper",
    nato: "Bot Echo",
    hint: "Waits, then jumps",
    initials: "SN",
    photoPreset: "tunnel",
    bannerPreset: "away_slate",
    ceilMin: 0.82,
    ceilMax: 1.08,
    jumpMult: 1.35,
    minJump: 4,
    luxuryMult: 0.65,
  },
  {
    id: "accountant",
    name: "The Accountant",
    nato: "Bot Foxtrot",
    hint: "Spends leftover cap",
    initials: "AC",
    photoPreset: "locker_lights",
    bannerPreset: "home_white",
    ceilMin: 0.9,
    ceilMax: 1.08,
    jumpMult: 1.05,
    minJump: null,
    luxuryMult: 0.95,
  },
  {
    id: "gambler",
    name: "The Gambler",
    nato: "Bot Golf",
    hint: "Wide range, big swings",
    initials: "GM",
    photoPreset: "storm",
    bannerPreset: "amber_edge",
    ceilMin: 0.7,
    ceilMax: 1.25,
    jumpMult: 1.25,
    minJump: 3,
    luxuryMult: 0.8,
  },
  {
    id: "patriot",
    name: "The Patriot",
    nato: "Bot Hotel",
    hint: "Pays up for stars",
    initials: "PT",
    photoPreset: "night",
    bannerPreset: "navy_stripe",
    ceilMin: 0.92,
    ceilMax: 1.18,
    jumpMult: 1.15,
    minJump: null,
    luxuryMult: 0.7,
  },
  {
    id: "copier",
    name: "The Copier",
    nato: "Bot India",
    hint: "Bids the minimum raise",
    initials: "CP",
    photoPreset: "gridiron",
    bannerPreset: "away_slate",
    ceilMin: 0.85,
    ceilMax: 1.05,
    jumpMult: 0.35,
    minJump: null,
    luxuryMult: 0.6,
  },
  {
    id: "closer",
    name: "The Closer",
    nato: "Bot Juliet",
    hint: "Aggressive late",
    initials: "CL",
    photoPreset: "tunnel",
    bannerPreset: "championship",
    ceilMin: 0.95,
    ceilMax: 1.16,
    jumpMult: 1.3,
    minJump: 5,
    luxuryMult: 0.85,
  },
  {
    id: "miser",
    name: "The Miser",
    nato: "Bot Kilo",
    hint: "Cheapest possible",
    initials: "MS",
    photoPreset: "turf",
    bannerPreset: "teal_fade",
    ceilMin: 0.7,
    ceilMax: 0.84,
    jumpMult: 0.6,
    minJump: null,
    luxuryMult: 0.45,
  },
]);

const NATO_RE = /^bot\s+(alpha|bravo|charlie|delta|echo|foxtrot|golf|hotel|india|juliet|kilo)$/i;

const BY_KEY = new Map();
for (const persona of BOT_PERSONAS) {
  BY_KEY.set(persona.id, persona);
  BY_KEY.set(persona.name.toLowerCase(), persona);
  BY_KEY.set(persona.nato.toLowerCase(), persona);
}

function hashKey(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function looksLikeNatoBotName(name) {
  return NATO_RE.test(String(name || "").trim());
}

export function resolveBotPersona(team) {
  const name = String(team?.name || team?.team_name || "").trim();
  const keyed = BY_KEY.get(name.toLowerCase());
  if (keyed) return keyed;
  if (!team?.is_bot && !looksLikeNatoBotName(name)) return null;
  const seed = team?.id || team?.team_id || name || "bot";
  return BOT_PERSONAS[hashKey(seed) % BOT_PERSONAS.length];
}

export function displayBotName(name, team) {
  const persona = resolveBotPersona(team || { name, is_bot: looksLikeNatoBotName(name) });
  return persona?.name || name || "";
}

export function botIdentityLook(team) {
  const persona = resolveBotPersona(team);
  if (!persona) return null;
  return {
    photo_preset: persona.photoPreset,
    banner_preset: persona.bannerPreset,
    photo_media_id: null,
    banner_media_id: null,
    photo_url: null,
    banner_url: null,
  };
}

export function botInitials(team) {
  const persona = resolveBotPersona(team);
  if (persona?.initials) return persona.initials;
  const name = displayBotName(team?.name, team);
  const parts = String(name || "").replace(/^The\s+/i, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "BT";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
