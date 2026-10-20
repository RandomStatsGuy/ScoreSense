import React, { useRef } from "react";
import AppBottomNav from "../AppBottomNav";
import useMobileLayout from "../useMobileLayout";
import useBottomClearance from "../ui/useBottomClearance";

export default function MobileShell({
  children,
  section,
  onSectionChange,
  onMoreOpen,
  hrefForSection,
  className = "",
}) {
  const mobileLayout = useMobileLayout();
  const root = useRef(null);
  useBottomClearance(root, mobileLayout);
  return (
    <div ref={root} data-bottom-clearance className={`app${mobileLayout ? " app-with-bottom-nav" : ""} ${className}`.trim()}>
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
