import { apiFetch } from "../auth.js";
import { withHubMediaWidth } from "./atmosphereCatalog.js";

const cache = new Map();
const inflight = new Map();

export function resetHubMediaUrlCacheForTests() {
  cache.clear();
  inflight.clear();
}

export function hubMediaInflightCount() {
  return inflight.size;
}

export function resolveHubMediaSrc(src, width) {
  return withHubMediaWidth(src, width) || "";
}

export function isHubMediaApiSrc(src) {
  const href = String(src || "");
  return href.startsWith("/api/hub/media/") || href.includes("/api/hub/media/");
}

export function peekHubMediaObjectUrl(src) {
  if (!src) return "";
  if (cache.has(src)) return cache.get(src);
  // Remote CDN / data URLs paint as-is. Blob-fetching ESPN or Sleeper
  // sends cookies cross-origin and fails CORS, which blanks the image.
  if (!isHubMediaApiSrc(src)) return src;
  return "";
}

export function ensureHubMediaObjectUrl(src) {
  if (!src) return Promise.resolve("");
  if (!isHubMediaApiSrc(src)) return Promise.resolve(src);
  if (cache.has(src)) return Promise.resolve(cache.get(src));
  const existing = inflight.get(src);
  if (existing) return existing;
  const request = (async () => {
    const res = await apiFetch(src);
    if (!res.ok) {
      const err = new Error(`hub media ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    cache.set(src, objectUrl);
    return objectUrl;
  })();
  inflight.set(src, request);
  request.finally(() => {
    if (inflight.get(src) === request) inflight.delete(src);
  });
  return request;
}
