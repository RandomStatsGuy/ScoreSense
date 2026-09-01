export const ATMOSPHERE_THEMES = ["none", "snow", "leaves", "footballs", "cozy"];
export const ATMOSPHERE_INTENSITIES = ["subtle", "standard", "lively"];
export const PHOTO_PRESETS = ["gridiron", "tunnel", "night", "turf", "storm", "locker_lights"];
export const BANNER_PRESETS = ["navy_stripe", "teal_fade", "amber_edge", "home_white", "away_slate", "championship"];
export const ROOM_THEMES = ["none", "locker"];
export const MAX_LOCKER_PLAYERS = 8;

export const DEFAULT_FOCUS = { x: 50, y: 50, zoom: 1 };

export const PHOTO_LABELS = {
  gridiron: "Gridiron",
  tunnel: "Tunnel",
  night: "Night kickoff",
  turf: "Turf",
  storm: "Storm",
  locker_lights: "Locker lights",
};

export const BANNER_LABELS = {
  navy_stripe: "Navy stripe",
  teal_fade: "Teal fade",
  amber_edge: "Amber edge",
  home_white: "Home white",
  away_slate: "Away slate",
  championship: "Championship",
};

export const DEFAULT_IDENTITY = {
  photo_preset: "gridiron",
  banner_preset: "navy_stripe",
  photo_media_id: null,
  banner_media_id: null,
  photo_url: null,
  banner_url: null,
  photo_focus: { ...DEFAULT_FOCUS },
  banner_focus: { ...DEFAULT_FOCUS },
  room_theme: "none",
  locker_player_ids: [],
};

export const ATMOSPHERE_CHANGED_EVENT = "scoresense-atmosphere-changed";

export const ATMOSPHERE_COPY = {
  none: { title: "Off", support: "Keep Fantasy quiet. Recommended default." },
  snow: { title: "Snow", support: "A faint winter drift behind the page." },
  leaves: { title: "Fall leaves", support: "A light autumn fall, never in front of the board." },
  footballs: { title: "Footballs", support: "Soft footballs drifting in the background." },
  cozy: { title: "Cozy den", support: "Lamplight, drifting fur and yarn — and ragdolls who notice your cursor." },
};

/** Copy for the tailoring controls under the theme picker. */
export const ATMOSPHERE_OPTION_COPY = {
  motion: { title: "Falling animation", support: "Particles drift down the page and react to your cursor." },
  pile: { title: "Ground pile", support: "Let it collect along the bottom of the page." },
  wash: { title: "Color wash", support: "Tint the background to match the theme." },
  intensity: {
    subtle: { title: "Subtle", support: "Barely there." },
    standard: { title: "Standard", support: "The intended look." },
    lively: { title: "Lively", support: "More of everything." },
  },
};

export const EMOTE_COPY = {
  walkoff: { title: "Walk-off", hint: "Leave the field first." },
  salute: { title: "Salute", hint: "A clean, smug tip of the cap." },
  flex: { title: "Flex", hint: "Show the work." },
  bow: { title: "Bow", hint: "Thank the crowd. Or don't." },
  point: { title: "Point", hint: "That's you. That's the loss." },
  micdrop: { title: "Mic drop", hint: "Scoreboard closed." },
};

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function mergeFocus(raw) {
  return {
    x: clampNum(raw?.x, 0, 100, DEFAULT_FOCUS.x),
    y: clampNum(raw?.y, 0, 100, DEFAULT_FOCUS.y),
    zoom: clampNum(raw?.zoom, 1, 2.5, DEFAULT_FOCUS.zoom),
  };
}

export function focusCssVars(focus) {
  const next = mergeFocus(focus);
  return {
    "--crop-x": `${next.x}%`,
    "--crop-y": `${next.y}%`,
    "--crop-zoom": String(next.zoom),
  };
}

export function identityMediaUrl(identity, kind) {
  if (!identity) return null;
  if (kind === "banner") {
    return identity.banner_url || (identity.banner_media_id ? `/api/hub/media/${identity.banner_media_id}` : null);
  }
  return identity.photo_url || (identity.photo_media_id ? `/api/hub/media/${identity.photo_media_id}` : null);
}

function coerceBool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Boolean(value);
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) return true;
    if (["0", "false", "no", "off"].includes(text)) return false;
  }
  return fallback;
}

export function mergeAtmospherePrefs(raw) {
  const theme = String(raw?.atmosphere || "none").toLowerCase();
  const intensity = String(raw?.atmosphere_intensity || "standard").toLowerCase();
  return {
    atmosphere: ATMOSPHERE_THEMES.includes(theme) ? theme : "none",
    motion: coerceBool(raw?.atmosphere_motion, true),
    pile: coerceBool(raw?.atmosphere_pile, true),
    wash: coerceBool(raw?.atmosphere_wash, true),
    intensity: ATMOSPHERE_INTENSITIES.includes(intensity) ? intensity : "standard",
  };
}

/** Lay an API-shaped patch over already-merged prefs (optimistic UI). */
export function applyAtmospherePatch(prefs, patch) {
  const current = prefs && typeof prefs === "object" ? prefs : mergeAtmospherePrefs(null);
  return mergeAtmospherePrefs({
    atmosphere: current.atmosphere,
    atmosphere_motion: current.motion,
    atmosphere_pile: current.pile,
    atmosphere_wash: current.wash,
    atmosphere_intensity: current.intensity,
    ...(patch && typeof patch === "object" ? patch : {}),
  });
}

export function notifyAtmosphereChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ATMOSPHERE_CHANGED_EVENT));
}

export function mergeTeamIdentity(raw) {
  const next = { ...DEFAULT_IDENTITY, ...(raw && typeof raw === "object" ? raw : {}) };
  if (!PHOTO_PRESETS.includes(next.photo_preset)) next.photo_preset = DEFAULT_IDENTITY.photo_preset;
  if (!BANNER_PRESETS.includes(next.banner_preset)) next.banner_preset = DEFAULT_IDENTITY.banner_preset;
  if (!ROOM_THEMES.includes(next.room_theme)) next.room_theme = "none";
  next.photo_focus = mergeFocus(next.photo_focus);
  next.banner_focus = mergeFocus(next.banner_focus);
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

/** Whether the ambience layer mounts at all. Reduced motion no longer hides
 * the layer — it only freezes it (static wash/pile, no falling particles or
 * reactions); that gating lives in the layer itself. */
export function shouldShowAtmosphere(theme, { liveDraft = false } = {}) {
  if (liveDraft) return false;
  return ATMOSPHERE_THEMES.includes(theme) && theme !== "none";
}

export function emoteTitle(key) {
  return EMOTE_COPY[key]?.title || "Reaction";
}
