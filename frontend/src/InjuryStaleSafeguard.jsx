import React from "react";
import { injuryStaleSafeguardMessage } from "./playerContextDisplay";

/**
 * SCORE-33: suppress false "Included in projection" claims when injury
 * status is newer than the projection snapshot.
 */
export default function InjuryStaleSafeguard({
  context,
  className = "",
  compact = false,
}) {
  const message = injuryStaleSafeguardMessage(context);
  if (!message) return null;
  if (compact) {
    return (
      <span
        className={`injury-stale-safeguard injury-stale-safeguard--compact ${className}`.trim()}
        role="note"
        title={message}
      >
        Refresh to update
      </span>
    );
  }
  return (
    <p
      className={`injury-stale-safeguard ${className}`.trim()}
      role="status"
    >
      {message}
    </p>
  );
}
