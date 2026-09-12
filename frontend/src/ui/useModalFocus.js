import { useEffect, useRef } from "react";

// A stack keeps a confirmation opened over an editor in charge of the keyboard.
const stack = [];
export default function useModalFocus(open, ref, onClose, initialRef) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const entry = {};
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    stack.push(entry);
    document.body.style.overflow = "hidden";
    const background = Array.from(document.body.children)
      .filter((el) => !el.contains(ref.current))
      .map((el) => [el, el.inert]);
    background.forEach(([el]) => { el.inert = true; });
    const focusables = () => Array.from(ref.current?.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) || []).filter((el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length);
    const focusFirst = () => (initialRef?.current || focusables()[0] || ref.current)?.focus();
    focusFirst();
    const onKey = (event) => {
      if (stack.at(-1) !== entry) return;
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
      if (stack.at(-1) === entry && !ref.current?.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      document.body.style.overflow = overflow;
      background.forEach(([el, inert]) => { el.inert = inert; });
      if (previous?.isConnected) previous.focus();
    };
  }, [open, ref, initialRef]);
}
