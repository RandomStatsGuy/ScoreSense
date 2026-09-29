import { DFS_RESULTS_COPY as C } from "./dfsToolPresentation.js";

/**
 * Read a JSON API response, or say what answered instead.
 *
 * A body that is not JSON means something other than the API replied: a proxy
 * error page while the container restarts, a CDN interstitial, a sign-in page.
 * The status and the path are actionable. "Unexpected token '<'" — the first
 * character of somebody else's HTML — is not, and it was what every caller of
 * this helper reported, because the body was parsed before the status was
 * looked at.
 */
export async function readJsonResponse(response, url = "") {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(C.notJson(url, response.status));
  }
  if (!response.ok) {
    throw new Error(typeof data?.detail === "string" ? data.detail : C.requestFailed);
  }
  return data;
}
