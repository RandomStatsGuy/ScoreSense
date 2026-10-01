import React from "react";
import { Link } from "react-router-dom";
import useMobileLayout from "../useMobileLayout";

export function StandaloneFormContent({ children }) {
  return <div className="standalone-form-content">{children}</div>;
}

export function StandalonePageFooter({ children }) {
  return <div className="standalone-page-footer">{children}</div>;
}

export function StandaloneFormRow({ children }) {
  return <div className="standalone-form-row">{children}</div>;
}

export default function StandalonePageShell({
  title,
  backTo = "/projections/weekly",
  backLabel = "Back",
  children,
  className = "",
}) {
  const mobileLayout = useMobileLayout();

  return (
    <div className={`standalone-page${mobileLayout ? " standalone-page--mobile" : ""} ${className}`.trim()}>
      {mobileLayout ? (
        <header className="standalone-page-header">
          <Link to={backTo} className="standalone-page-back">
            ← {backLabel}
          </Link>
          {title ? <h1 className="standalone-page-title">{title}</h1> : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}
