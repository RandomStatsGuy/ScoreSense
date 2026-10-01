export const THEME_COPY = Object.freeze({
  title: "Color mode",
  support: "System, light, or dark. Saved in this browser.",
  light: "Switch to light mode",
  dark: "Switch to dark mode",
});

export const APPEARANCE_COPY = Object.freeze({
  title: "Appearance",
  support: "A coordinated theme across Projections, Fantasy, and Tools.",
  mode: "Color mode",
  modes: [
    { id: "system", title: "System" },
    { id: "light", title: "Light" },
    { id: "dark", title: "Dark" },
  ],
  theme: "Theme",
  themes: [
    { id: "none", title: "Classic", support: "Clean · editorial" },
    { id: "cozy", title: "Cozy den", support: "Cats · lamplight" },
    { id: "snow", title: "Snowfall", support: "Snow · blue hour" },
    { id: "leaves", title: "Autumn", support: "Leaves · copper" },
    { id: "footballs", title: "Footballs", support: "Leather · game day" },
  ],
  atmosphere: "Atmosphere",
  atmosphereSupport: "Keep the cats, falling snow, or leaves behind the page.",
  motion: "Motion",
  motionSupport: "Let the scene drift and react to your cursor.",
  detail: "More scene options",
  saved: "Appearance saved.",
  saving: "Saving appearance…",
  loading: "Loading your appearance…",
  failed: "Could not save appearance. Your previous settings are restored.",
  loadFailed: "Could not load your saved appearance. Try again before changing it.",
  retry: "Try again",
  still: "Turning off motion keeps a still scene. Reduced-motion settings are respected. Draft workspaces stay clear.",
});
