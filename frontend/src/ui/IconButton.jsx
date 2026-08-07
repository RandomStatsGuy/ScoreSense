import React from "react";

/** Compact icon-only button. Always requires an accessible label. */
export default function IconButton({ label, className = "", children, type = "button", ...rest }) {
  return (
    <button
      type={type}
      className={`ui-icon-btn ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}
