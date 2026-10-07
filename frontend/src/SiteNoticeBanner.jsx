import React, { useEffect, useState } from "react";

const POLL_MS = 5 * 60 * 1000;

/** Admin-set maintenance notice (Admin → Settings). Shown to everyone, signed in or not. */
export default function SiteNoticeBanner() {
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/site/notice", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setMessage(body?.message || null);
      } catch {
        // A missing notice is not worth an error on every page.
      }
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!message) return null;
  return (
    <div className="site-notice-banner" role="status">
      <p>{message}</p>
    </div>
  );
}
