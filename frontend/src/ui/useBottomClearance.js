import { useLayoutEffect } from "react";

/** Space occupied by detached actions above the measured bottom navigation. */
export function bottomActionClearance(viewportHeight, navHeight, actions) {
  return Math.ceil(Math.max(0, ...actions
    .filter(({ fixed, visible }) => fixed && visible)
    .map(({ top }) => Math.max(0, viewportHeight - top - navHeight))));
}

export default function useBottomClearance(root, mobileLayout) {
  useLayoutEffect(() => {
    const shell = root.current;
    if (!shell) return undefined;
    let frame, active = true;
    const observed = new Set();
    const style = document.documentElement.style;
    const write = (name, value) => {
      const next = `${value}px`;
      if (style.getPropertyValue(name) !== next) style.setProperty(name, next);
    };
    const schedule = () => { if (active) { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); } };
    const sizes = new ResizeObserver(schedule);
    function measure() {
      const nav = shell.querySelector(".app-bottom-nav");
      const navHeight = Math.ceil(nav?.getBoundingClientRect().height || 0);
      const bars = [...shell.querySelectorAll("[data-bottom-actions]")];
      for (const bar of bars) {
        const position=getComputedStyle(bar).position;
        if(bar.dataset.bottomPosition!==position)bar.dataset.bottomPosition=position;
      }
      const topBars = [...shell.querySelectorAll('[data-top-actions]')];
      write('--top-action-height', Math.ceil(Math.max(0,...topBars.map(element=>{
        const css=getComputedStyle(element);
        return ['sticky','fixed'].includes(css.position)&&element.getClientRects().length&&css.visibility!=='hidden'
          ? Math.max(0,parseFloat(css.top)||0)+element.getBoundingClientRect().height : 0;
      }))));
      const elements = [nav, ...bars, ...topBars].filter(Boolean);
      for (const element of observed) if (!elements.includes(element)) { sizes.unobserve(element); observed.delete(element); }
      for (const element of elements) if (!observed.has(element)) { sizes.observe(element); observed.add(element); }
      write("--bottom-nav-height", navHeight);
      write("--bottom-action-height", bottomActionClearance(innerHeight, navHeight, bars.map(element => ({
        top: element.getBoundingClientRect().top,
        fixed: getComputedStyle(element).position === "fixed",
        visible: (!element.checkVisibility || element.checkVisibility()) && getComputedStyle(element).visibility === "visible" && element.getBoundingClientRect().height > 0,
      }))));
    }
    const changes = new MutationObserver(schedule);
    changes.observe(shell, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-top-actions"] });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    measure();
    return () => {
      active = false; cancelAnimationFrame(frame); sizes.disconnect(); changes.disconnect();
      window.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("resize", schedule);
      style.removeProperty("--bottom-nav-height"); style.removeProperty("--bottom-action-height"); style.removeProperty("--top-action-height");
    };
  }, [root, mobileLayout]);
}
