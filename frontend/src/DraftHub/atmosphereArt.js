/** Particle descriptors + SVG geometry for AtmosphereLayer.
 *
 * Pure and deterministic under an injectable rng so node:test can pin
 * outputs. Rendering (JSX) stays in AtmosphereLayer.jsx; this module only
 * decides what falls, where, how big, and how it moves.
 */

/** Parallax depth layers. share sums to 1; durationMul slows far layers. */
export const ATMOSPHERE_LAYERS = [
  { id: "far", sizeMin: 10, sizeMax: 16, durationMul: 1.55, share: 0.34 },
  { id: "mid", sizeMin: 16, sizeMax: 24, durationMul: 1.2, share: 0.4 },
  { id: "near", sizeMin: 24, sizeMax: 36, durationMul: 0.85, share: 0.26 },
];

/** Total particles across all layers. Kept low — this is ambience, not confetti. */
export const ATMOSPHERE_DENSITY = 24;

/** Intensity presets: particle budget + overall layer opacity. */
export const ATMOSPHERE_INTENSITY_PRESETS = {
  subtle: { density: 14, opacity: 0.26 },
  standard: { density: ATMOSPHERE_DENSITY, opacity: 0.36 },
  lively: { density: 36, opacity: 0.46 },
};

export function intensityPreset(intensity) {
  return ATMOSPHERE_INTENSITY_PRESETS[intensity] || ATMOSPHERE_INTENSITY_PRESETS.standard;
}

/** Theme-level size multipliers (leaves/footballs read poorly at snow sizes). */
const THEME_SIZE_MUL = { snow: 1.05, leaves: 1.4, footballs: 2.15, cozy: 1.35 };

/** Autumn palette: [bodyTop, bodyBottom] gradient stops per leaf. */
export const LEAF_COLORS = [
  ["#d98a2b", "#a04a17"],
  ["#c45c26", "#8a3312"],
  ["#e0b04e", "#b07020"],
  ["#a83c1e", "#6f2410"],
  ["#b9702a", "#7d4415"],
];

/** Leaf silhouettes in a 100×110 viewBox (stem exits the bottom). */
export const LEAF_VARIANTS = [
  {
    id: "pointed",
    body: "M50 6 C76 20 86 50 64 80 C58 87 53 90 50 92 C47 90 42 87 36 80 C14 50 24 20 50 6 Z",
    stem: "M50 92 L50 106",
    veins: "M50 14 L50 88 M50 34 L66 24 M50 34 L34 24 M50 54 L70 42 M50 54 L30 42 M50 72 L64 62 M50 72 L36 62",
  },
  {
    id: "maple",
    body: "M50 4 L58 20 L70 10 L68 28 L90 22 L80 40 L96 48 L76 54 L84 72 L62 64 L58 78 L50 70 L42 78 L38 64 L16 72 L24 54 L4 48 L20 40 L10 22 L32 28 L30 10 L42 20 Z",
    stem: "M50 70 L50 104",
    veins: "M50 12 L50 66 M50 44 L74 30 M50 44 L26 30 M50 58 L70 52 M50 58 L30 52",
  },
];

/** Snowflake crystal: one arm; the renderer rotates it six times. */
export const SNOW_ARM_PATH = "M50 50 L50 10 M50 18 L42 10 M50 18 L58 10 M50 30 L41 22 M50 30 L59 22";

/** Ragdoll-coat fur palette: [core, edge] soft cream/grey pairs. */
export const FUR_COLORS = [
  ["#efe6d8", "#cbbba6"],
  ["#e6dacb", "#b8a894"],
  ["#ded3c6", "#a99a8c"],
  ["#e9dfd4", "#c1ae9b"],
];

/** Yarn palette for the cozy den: dusty, warm, never neon. */
export const YARN_COLORS = [
  ["#c98a8a", "#8f5a5a"],
  ["#9ab08f", "#657a5c"],
  ["#d9c27a", "#a08a4c"],
  ["#a58ec2", "#6f5c8a"],
  ["#c7986b", "#8f6a45"],
];

/** Wispy fur-tuft silhouette (100×100) with a few loose hair strokes. */
export const FUR_TUFT = {
  body: "M50 18 C68 14 84 30 80 48 C92 56 86 74 70 74 C64 88 40 90 32 76 C16 76 10 58 22 48 C16 32 34 16 50 18 Z",
  hairs: "M50 18 C52 8 60 6 64 10 M78 44 C88 40 94 46 92 52 M34 76 C30 86 20 88 16 84 M24 48 C14 44 10 36 14 30",
};

/** Football geometry in a 120×74 viewBox. */
export const FOOTBALL = {
  body: { cx: 60, cy: 37, rx: 56, ry: 30 },
  sheen: "M14 22 Q60 2 106 22",
  seam: "M18 37 Q60 32 102 37",
  laceXs: [38, 49, 60, 71, 82],
  laceY: [30, 44],
  stripes: ["M13 26 Q10 37 13 48", "M107 26 Q110 37 107 48"],
  colors: ["#a5622e", "#7d4517", "#5b300e"],
};

function rand(rng, min, max) {
  return min + rng() * (max - min);
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)] ?? list[0];
}

function buildParticle(theme, layer, index, rng) {
  const sizeMul = THEME_SIZE_MUL[theme] ?? 1;
  const size = rand(rng, layer.sizeMin, layer.sizeMax) * sizeMul;
  const particle = {
    id: `${theme}-${layer.id}-${index}`,
    theme,
    layer: layer.id,
    size: Math.round(size * 10) / 10,
    left: Math.round(rand(rng, -4, 102) * 10) / 10,
    fallDuration: Math.round(rand(rng, 9, 17) * layer.durationMul * 10) / 10,
    /** Negative delay spreads particles across the viewport on first paint. */
    fallDelay: Math.round(rand(rng, -17, 0) * 10) / 10,
    drift: Math.round(rand(rng, -30, 30)),
    swayAmp: Math.round(rand(rng, 8, theme === "snow" ? 24 : 38)),
    swayDuration: Math.round(rand(rng, 2.4, 4.6) * 10) / 10,
    spinDuration: Math.round(rand(rng, theme === "snow" ? 10 : 4, theme === "snow" ? 18 : 9) * 10) / 10,
    /** Footballs alternate between end-over-end spins and a gentle rock. */
    spinMode: theme === "footballs" && rng() < 0.5 ? "rock" : "spin",
    variant: 0,
    colors: null,
    /** Cursor drift only nudges the closer layers. */
    interactive: layer.id !== "far",
  };
  if (theme === "leaves") {
    particle.variant = rng() < 0.5 ? 0 : 1;
    particle.colors = pick(rng, LEAF_COLORS);
  } else if (theme === "snow") {
    /** 0 = soft dot (depth filler), 1 = crystal flake. */
    particle.variant = rng() < 0.45 ? 0 : 1;
  } else if (theme === "cozy") {
    /** 0 = dust mote (depth filler), 1 = fur tuft, 2 = yarn ball. */
    const roll = rng();
    if (layer.id === "far" || roll < 0.2) {
      particle.variant = 0;
    } else if (roll < 0.7) {
      particle.variant = 1;
      particle.colors = pick(rng, FUR_COLORS);
    } else {
      particle.variant = 2;
      particle.colors = pick(rng, YARN_COLORS);
      /** Yarn rolls end-over-end; fur just drifts. */
      particle.spinMode = "spin";
      particle.size = Math.round(particle.size * 1.2 * 10) / 10;
    }
    if (particle.variant === 1) {
      /** Fur floats: slower fall, wider sway, lazy rock. */
      particle.fallDuration = Math.round(particle.fallDuration * 1.3 * 10) / 10;
      particle.spinMode = "rock";
    }
  }
  return particle;
}

/** Ground-pile clusters along the bottom edge: left %, scale, mirrored, variant.
 * The renderer draws theme-specific mound art per cluster. */
export function buildPileClusters(theme, { rng = Math.random, count = 9 } = {}) {
  if (!Object.prototype.hasOwnProperty.call(THEME_SIZE_MUL, theme)) return [];
  const clusters = [];
  const n = theme === "footballs" ? Math.min(count, 6) : count;
  for (let i = 0; i < n; i += 1) {
    const lane = (i + 0.5) / n;
    clusters.push({
      id: `pile-${theme}-${i}`,
      left: Math.round((lane * 100 + rand(rng, -6, 6)) * 10) / 10,
      scale: Math.round(rand(rng, 0.65, 1.25) * 100) / 100,
      flip: rng() < 0.5,
      variant: Math.floor(rng() * 3),
      colors: theme === "leaves"
        ? pick(rng, LEAF_COLORS)
        : theme === "cozy"
          ? pick(rng, FUR_COLORS)
          : null,
      /** Short stagger so the pile is present immediately, then settles. */
      growDelay: Math.round(rand(rng, 0, 8)),
    });
  }
  return clusters;
}

/**
 * Build the full particle set for a theme.
 * @param theme "snow" | "leaves" | "footballs" (anything else → []).
 * @param opts density = total target count; rng = () => [0,1) for tests.
 */
export function buildAtmosphereParticles(theme, { density = ATMOSPHERE_DENSITY, rng = Math.random } = {}) {
  if (!Object.prototype.hasOwnProperty.call(THEME_SIZE_MUL, theme)) return [];
  const out = [];
  ATMOSPHERE_LAYERS.forEach((layer) => {
    const count = Math.max(2, Math.round(density * layer.share));
    for (let i = 0; i < count; i += 1) {
      out.push(buildParticle(theme, layer, out.length, rng));
    }
  });
  return out;
}
