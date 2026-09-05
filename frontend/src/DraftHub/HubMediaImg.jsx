import React, { useEffect, useState } from "react";
import {
  ensureHubMediaObjectUrl,
  peekHubMediaObjectUrl,
  resolveHubMediaSrc,
} from "./hubMediaUrl";

export { ensureHubMediaObjectUrl, hubMediaInflightCount, resetHubMediaUrlCacheForTests } from "./hubMediaUrl";

export function useHubMediaUrl(src, { width } = {}) {
  const resolved = resolveHubMediaSrc(src, width);
  const [url, setUrl] = useState(() => peekHubMediaObjectUrl(resolved));

  useEffect(() => {
    if (!resolved) {
      setUrl("");
      return undefined;
    }
    const cached = peekHubMediaObjectUrl(resolved);
    if (cached) {
      setUrl(cached);
      return undefined;
    }
    let cancelled = false;
    ensureHubMediaObjectUrl(resolved)
      .then((objectUrl) => {
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  return url;
}

export default function HubMediaImg({ src, alt = "", className = "", style, width }) {
  const url = useHubMediaUrl(src, { width });
  if (!url) return null;
  return <img src={url} alt={alt} className={className} style={style} />;
}
