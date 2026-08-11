/**
 * Used when the Vercel Root Directory is `frontend`.
 * Prefer repo-root `vercel.ts` with Root Directory = `.`.
 *
 * Requires SCORESENSE_API_ORIGIN (production origin, no trailing slash).
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

export const config = { rewrites };
