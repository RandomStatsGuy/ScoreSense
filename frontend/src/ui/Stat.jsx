import React from "react";

/** Label + value pair with tabular numerals for the value. */
export default function Stat({ label, value, tone, className = "", ...rest }) {
  const toneClass = tone ? `ui-stat--${tone}` : "";
  return (
    <div className={`ui-stat ${toneClass} ${className}`.trim()} {...rest}>
      <span className="ui-stat-value num">{value}</span>
      <span className="ui-stat-label">{label}</span>
    </div>
  );
}
