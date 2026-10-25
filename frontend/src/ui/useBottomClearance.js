import { useLayoutEffect } from "react";

/** Space occupied by detached actions above the measured bottom navigation. */
export function bottomActionClearance(viewportHeight, navHeight, actions) {
  return Math.ceil(Math.max(0, ...actions
    .filter(({ fixed, visible }) => fixed && visible)
    .map(({ top }) => Math.max(0, viewportHeight - top - navHeight))));
}

/** Reveal the action group when it fits; otherwise preserve its focused control. */
export function focusClearanceDelta(focused, group, top, bottom) {
  if (bottom <= top) return 0;
  const target = group.bottom - group.top <= bottom - top ? group : focused;
  if (target.bottom > bottom) return target.bottom - bottom;
  if (target.top < top) return target.top - top;
  return 0;
}

export default function useBottomClearance(root, mobileLayout) {
  useLayoutEffect(() => {
    const shell = root.current;
    if (!shell) return undefined;
    let frame, focusFrame, active = true;
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
    // Focus scrolling differs between engines; CSS owns the measured boundaries.
    function revealFocus(event) {
      const element = event?.target || document.activeElement;
      if (!(element instanceof HTMLElement) || !shell.contains(element)
        || !shell.querySelector('[data-top-actions]')
        || element.closest('[data-top-actions], .app-bottom-nav, [role="dialog"], [aria-modal="true"]')) return;
      const group = element.closest('[data-focus-group]') || element;
      const css = getComputedStyle(document.documentElement);
      const viewport = window.visualViewport;
      const start = (viewport?.offsetTop || 0) + (parseFloat(css.scrollPaddingBlockStart) || 0);
      const end = (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - (parseFloat(css.scrollPaddingBlockEnd) || 0);
      const delta = focusClearanceDelta(element.getBoundingClientRect(), group.getBoundingClientRect(), start, end);
      if (delta) window.scrollBy({top:delta,behavior:'instant'});
    }
    const onFocus = event => {
      revealFocus(event);
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => revealFocus());
    };
    shell.addEventListener('focusin', onFocus);
    const changes = new MutationObserver(schedule);
    changes.observe(shell, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-top-actions"] });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    measure();
    return () => {
      active = false; cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); shell.removeEventListener('focusin', onFocus); sizes.disconnect(); changes.disconnect();
      window.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("resize", schedule);
      style.removeProperty("--bottom-nav-height"); style.removeProperty("--bottom-action-height"); style.removeProperty("--top-action-height");
    };
  }, [root, mobileLayout]);
}
