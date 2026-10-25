import { useEffect, useRef } from "react";
import { lockModalBackground } from "./modalBackground";

// Keep the opener as the return target even when a pointer click does not focus it.
export function openModalFrom(trigger, open) {
  trigger?.focus({preventScroll:true});
  return open();
}

// The top modal owns keyboard input, even if a lower editor unmounts first.
export default function useModalFocus(open, ref, onClose, initialRef) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const previous = document.activeElement;
    const layer = lockModalBackground(ref.current);
    const focusables = () => Array.from(ref.current?.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
    ) || []).filter((el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length);
    const focusFirst = () => (initialRef?.current || focusables()[0] || ref.current)?.focus();
    focusFirst();
    const onKey = (event) => {
      if (!layer.isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current?.();
      }
      if (event.key === "Tab") {
        const items = focusables();
        const index = items.indexOf(document.activeElement);
        if (!items.length || index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === items.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) : items[0])?.focus();
        }
      }
    };
    const onFocus = (event) => {
      if (layer.isTop() && !ref.current?.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      const wasTop = layer.isTop();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      layer.release();
      if (wasTop && previous?.isConnected && !previous.closest("[inert]")) previous.focus();
    };
  }, [open, ref, initialRef]);
}
