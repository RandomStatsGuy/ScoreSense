import React, { useEffect, useState } from "react";
import { apiFetch } from "../auth";

const cache = new Map();

export function useHubMediaUrl(src) {
  const [url, setUrl] = useState(() => (src && cache.has(src) ? cache.get(src) : ""));

  useEffect(() => {
    if (!src) {
      setUrl("");
      return undefined;
    }
    if (cache.has(src)) {
      setUrl(cache.get(src));
      return undefined;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(src, { signal: ctrl.signal });
        if (cancelled || !res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        cache.set(src, objectUrl);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setUrl("");
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [src]);

  return url;
}

export default function HubMediaImg({ src, alt = "", className = "", style }) {
  const url = useHubMediaUrl(src);
  if (!url) return null;
  return <img src={url} alt={alt} className={className} style={style} />;
}
