import React, { useEffect } from "react";
import useMobileLayout from "./useMobileLayout";
import MobileBottomSheet from "./layout/MobileBottomSheet";

/** Keep the dismissible shell available while the player details chunk loads. */
export default function PlayerCardFrame({ title, onClose, children }) {
  const mobileLayout = useMobileLayout();
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  if (mobileLayout) {
    return (
      <MobileBottomSheet
        open
        onClose={onClose}
        title={title}
        className="player-card-sheet"
      >
        {children}
      </MobileBottomSheet>
    );
  }
  return (
    <div
      className="player-card-overlay player-card-overlay--drawer"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="player-card-dialog player-card-drawer panel"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
