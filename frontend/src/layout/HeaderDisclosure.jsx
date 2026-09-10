import React, { useEffect, useId, useRef, useState } from "react";

/** Accessible disclosure for navigation links and league-picker actions. */
export default function HeaderDisclosure({ label, accessibleLabel, children, active = false, disabled = false, className = "", resetKey }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  useEffect(() => { setOpen(false); }, [resetKey]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector("input, a, button:not(:disabled)")?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  return <div className={`fantasy-header-menu ${className}`} ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(true); }
    if (event.key === "ArrowDown" && event.target === trigger.current) { event.preventDefault(); setOpen(true); }
    else if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && event.target.tagName !== "INPUT") {
      const items = [...panel.current.querySelectorAll("a, button:not(:disabled)")];
      const index = items.indexOf(document.activeElement);
      if (!items.length) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
    }
  }}>
    <button ref={trigger} type="button" className={`fantasy-header-menu-trigger${active ? " is-active" : ""}`} aria-label={accessibleLabel} aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => setOpen(!open)}>{label}<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg></button>
    {open && <div ref={panel} id={id} className="fantasy-header-menu-panel" aria-label={accessibleLabel}>{children(() => close(true))}</div>}
  </div>;
}
