import React from "react";

function isTrivialAudience(audience) {
  if (!audience) return true;
  const t = audience.trim();
  return /^(you|solo)\b/i.test(t);
}

export default function HubTabIntro({
  title,
  purpose,
  audience,
  learnMore,
  children,
  className = "",
  compact = false,
}) {
  const showTitle = Boolean(title);
  const showPurpose = purpose && !compact;
  const showAudience = audience && !compact && !isTrivialAudience(audience);

  if (!showTitle && !showPurpose && !showAudience && !learnMore && !children) {
    return null;
  }

  return (
    <header className={`hub-tab-intro${className ? ` ${className}` : ""}${compact ? " hub-tab-intro-compact" : ""}`}>
      {(showTitle || showPurpose || showAudience) && (
        <div className="hub-tab-intro-main">
          {showTitle && <h2 className="hub-tab-intro-title">{title}</h2>}
          {showPurpose && <p className="hub-tab-intro-purpose">{purpose}</p>}
          {showAudience && <p className="hub-tab-intro-audience">{audience}</p>}
        </div>
      )}
      {learnMore && (
        <details className="hub-tab-intro-learn">
          <summary>More</summary>
          <div className="hub-tab-intro-learn-body">{learnMore}</div>
        </details>
      )}
      {children}
    </header>
  );
}
