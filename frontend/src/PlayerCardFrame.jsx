import React, { useRef } from "react";
import "./styles/player-profile.css";
import { createPortal } from "react-dom";
import useMobileLayout from "./useMobileLayout";
import MobileBottomSheet from "./layout/MobileBottomSheet";
import useModalFocus from "./ui/useModalFocus";

/** Keep the dismissible shell available while the player details chunk loads. */
export default function PlayerCardFrame({ title, onClose, children }) {
  const mobileLayout = useMobileLayout();
  const cardRef = useRef(null);
  const dismiss = () => {
    const injury = cardRef.current?.querySelector(".player-profile-injury[open]");
    if (injury) {
      injury.open = false;
      injury.querySelector("summary")?.focus();
      return;
    }
    onClose();
  };
  useModalFocus(!mobileLayout, cardRef, dismiss);
  if (mobileLayout) {
    return (
      <MobileBottomSheet
        open
        onClose={dismiss}
        ariaLabel={title}
        className="player-card-sheet"
      >
        <div ref={cardRef} className="player-card-sheet-content">{children}</div>
      </MobileBottomSheet>
    );
  }
  return createPortal(
    <div
      className="player-card-overlay player-card-overlay--center"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="player-card-dialog player-card-centered panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>, document.body
  );
}
