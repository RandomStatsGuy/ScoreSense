export const ATMOSPHERE_THEMES = ["none", "snow", "leaves", "footballs"];
export const PHOTO_PRESETS = ["gridiron", "tunnel", "night", "turf", "storm", "locker_lights"];
export const BANNER_PRESETS = ["navy_stripe", "teal_fade", "amber_edge", "home_white", "away_slate", "championship"];
export const ROOM_THEMES = ["none", "locker"];
export const MAX_LOCKER_PLAYERS = 8;

export const DEFAULT_IDENTITY = {
  photo_preset: "gridiron",
  banner_preset: "navy_stripe",
  photo_media_id: null,
  banner_media_id: null,
  photo_url: null,
  banner_url: null,
  room_theme: "none",
  locker_player_ids: [],
};

export const ATMOSPHERE_COPY = {
  none: { title: "Off", support: "Keep Fantasy quiet. Recommended default." },
  snow: { title: "Snow", support: "A faint winter drift behind the page." },
  leaves: { title: "Fall leaves", support: "A light autumn fall, never in front of the board." },
  footballs: { title: "Footballs", support: "Soft footballs drifting in the background." },
};

export const EMOTE_COPY = {
  walkoff: { title: "Walk-off", hint: "Leave the field first." },
  salute: { title: "Salute", hint: "A clean, smug tip of the cap." },
  flex: { title: "Flex", hint: "Show the work." },
  bow: { title: "Bow", hint: "Thank the crowd. Or don't." },
  point: { title: "Point", hint: "That's you. That's the loss." },
  micdrop: { title: "Mic drop", hint: "Scoreboard closed." },
};

export function mergeAtmospherePrefs(raw) {
  const theme = String(raw?.atmosphere || "none").toLowerCase();
  return { atmosphere: ATMOSPHERE_THEMES.includes(theme) ? theme : "none" };
}

export function mergeTeamIdentity(raw) {
  const next = { ...DEFAULT_IDENTITY, ...(raw && typeof raw === "object" ? raw : {}) };
  if (!PHOTO_PRESETS.includes(next.photo_preset)) next.photo_preset = DEFAULT_IDENTITY.photo_preset;
  if (!BANNER_PRESETS.includes(next.banner_preset)) next.banner_preset = DEFAULT_IDENTITY.banner_preset;
  if (!ROOM_THEMES.includes(next.room_theme)) next.room_theme = "none";
  const seen = new Set();
  next.locker_player_ids = (next.locker_player_ids || []).filter((id) => {
    const pid = String(id || "").trim();
    if (!pid || seen.has(pid)) return false;
    seen.add(pid);
    return true;
  }).slice(0, MAX_LOCKER_PLAYERS);
  return next;
}

export function lockerNameplate(playerName) {
  const name = String(playerName || "").trim();
  if (!name) return "";
  return name.split(/\s+/).pop().slice(0, 12);
}

export function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "TM";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function shouldShowAtmosphere(theme, { reducedMotion = false, liveDraft = false } = {}) {
  if (liveDraft) return false;
  if (reducedMotion) return false;
  return ATMOSPHERE_THEMES.includes(theme) && theme !== "none";
}

export function emoteTitle(key) {
  return EMOTE_COPY[key]?.title || "Reaction";
}
