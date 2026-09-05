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
