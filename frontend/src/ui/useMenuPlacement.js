import { useLayoutEffect } from "react";
import { menuPlacement } from "./menuPlacement";

const FIXED_CHROME = ".app-bottom-nav, .fantasy-chat-launcher-a";

/**
 * Keep an absolutely positioned menu panel clear of fixed phone chrome. Sets
 * `data-side="above"` when the list has more room over its trigger and caps the
 * panel's max-height to the space available. Static (inline) panels are left alone.
 */
export default function useMenuPlacement(open, triggerRef, panelRef) {
  useLayoutEffect(() => {
    if (!open) return undefined;
    let frame = 0;
    const place = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      panel.style.maxHeight = "";
      delete panel.dataset.side;
      if (getComputedStyle(panel).position !== "absolute") return;
      const own = panel.getBoundingClientRect();
      const obstacles = [...document.querySelectorAll(FIXED_CHROME)]
        .filter((el) => !el.contains(trigger) && getComputedStyle(el).position === "fixed")
        .map((el) => el.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0 && rect.left < own.right && rect.right > own.left);
      const { side, maxHeight } = menuPlacement({
        trigger: trigger.getBoundingClientRect(),
        panelHeight: own.height,
        viewportHeight: window.innerHeight,
        obstacles,
      });
      if (side === "above") panel.dataset.side = "above";
      if (maxHeight < own.height) panel.style.maxHeight = `${Math.floor(maxHeight)}px`;
    };
    const schedule = (event) => {
      if (event?.target instanceof Node && panelRef.current?.contains(event.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, triggerRef, panelRef]);
}
