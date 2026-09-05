import React from "react";
import AppBottomNav from "../AppBottomNav";
import useMobileLayout from "../useMobileLayout";

export default function MobileShell({
  children,
  section,
  onSectionChange,
  onMoreOpen,
  hrefForSection,
  className = "",
}) {
  const mobileLayout = useMobileLayout();
  return (
    <div className={`app${mobileLayout ? " app-with-bottom-nav" : ""} ${className}`.trim()}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {children}
      <AppBottomNav
        section={section}
        onSectionChange={onSectionChange}
        onMoreOpen={onMoreOpen}
        hrefForSection={hrefForSection}
      />
    </div>
  );
}
