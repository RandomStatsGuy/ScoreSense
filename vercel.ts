/**
 * Vercel project config (programmatic so preview API origin stays out of git).
 *
 * Set SCORESENSE_API_ORIGIN in the Vercel project (Preview + Production), e.g.
 * the public production app host without a trailing slash.
 */
const apiOrigin = (process.env.SCORESENSE_API_ORIGIN || "").replace(/\/$/, "");

const rewrites: { source: string; destination: string }[] = [];

if (apiOrigin) {
  rewrites.push({
    source: "/api/:path*",
    destination: `${apiOrigin}/api/:path*`,
  });
}

rewrites.push({
  source: "/((?!api/).*)",
  destination: "/index.html",
});

export const config = {
  framework: "vite" as const,
  installCommand: "npm ci --prefix frontend",
  buildCommand: "npm run build --prefix frontend",
  outputDirectory: "frontend/dist",
  rewrites,
  git: {
    deploymentEnabled: {
      "agent/**": false,
      "cursor/**": false,
    },
  },
};
