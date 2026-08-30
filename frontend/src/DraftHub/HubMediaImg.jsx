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
    let objectUrl = "";
    (async () => {
      try {
        const res = await apiFetch(src);
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        cache.set(src, objectUrl);
        if (!cancelled) setUrl(objectUrl);
      } catch {
        if (!cancelled) setUrl("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  return url;
}

export default function HubMediaImg({ src, alt = "", className = "" }) {
  const url = useHubMediaUrl(src);
  if (!url) return null;
  return <img src={url} alt={alt} className={className} />;
}
