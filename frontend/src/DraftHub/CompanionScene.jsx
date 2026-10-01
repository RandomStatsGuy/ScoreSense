import React, { useId, useLayoutEffect, useMemo, useRef } from "react";
import { APPEARANCE_COPY } from "../themePresentation";
import { buildCompanionArt } from "./companionArt";
import { clamp, releaseState, stepToy, toyBounds } from "./companionPhysics";

const KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "];

export default function CompanionScene({ theme, side = null, reactions = true }) {
  const scene = useMemo(() => buildCompanionArt(theme, side), [theme, side]);
  const prefix = useId().replace(/:/g, "");
  const stage = useRef(null);
  const controller = useRef(null);
  const descriptionId = prefix + "-instructions";
  // Prefix IDs because the Account preview and page scene can coexist.
  const markup = useMemo(() => scene.markup.replace(/id="(toy|cord)-/g, 'id="' + prefix + '-$1-'), [scene, prefix]);

  useLayoutEffect(() => {
    const host = stage.current;
    const svg = host.querySelector("svg");
    const toys = scene.toys.map((toy) => ({ ...toy, xNow: toy.x, yNow: toy.y, rotation: 0, sample: null, velocity: { x: 0, y: 0 } }));
    const moving = new Map();
    const resting = new Map();
    let frame = 0, lastTime = 0, activeDrag = null;
    const area = host.querySelector(".companion-drag-area");
    const node = (toy, kind) => host.querySelector('[id="' + prefix + '-' + kind + '-' + toy.id + '"]');
    const buddy = (toy) => host.querySelector('[data-buddy="' + toy.buddy + '"]');
    const button = (toy) => host.querySelector('.companion-interaction[data-toy="' + toy.id + '"]');

    const project = (x, y) => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      const rect = host.getBoundingClientRect();
      return { x: point.x - rect.left, y: point.y - rect.top };
    };
    const showArea = (toy) => {
      if (!reactions || !area) return;
      const bounds = toyBounds(toy), origin = project(bounds.left, bounds.top), end = project(bounds.right, bounds.bottom);
      if (!origin || !end) return;
      area.hidden = false;
      area.dataset.toy = toy.id;
      Object.assign(area.style, { left: origin.x + "px", top: origin.y + "px", width: (end.x - origin.x) + "px", height: (end.y - origin.y) + "px" });
    };
    const positionButton = (toy) => {
      const target = button(toy), point = project(toy.xNow, toy.yNow);
      if (target && point) Object.assign(target.style, { left: point.x + "px", top: point.y + "px" });
      if (area?.dataset.toy === toy.id && !area.hidden) showArea(toy);
    };
    const resetBuddy = (toy) => {
      const friend = buddy(toy);
      friend?.classList.remove("playing", "snack-happy");
      friend?.querySelectorAll(".awake-eyes").forEach((el) => { el.style.display = "none"; });
      friend?.querySelectorAll(".sleep-eyes").forEach((el) => { el.style.display = ""; });
      friend?.querySelectorAll(".companion-pupil").forEach((el) => { el.style.transform = ""; });
    };
    const paint = (toy) => {
      node(toy, "toy")?.setAttribute("transform", "translate(" + toy.xNow + " " + toy.yNow + ") rotate(" + toy.rotation + ")");
      if (toy.anchor) node(toy, "cord")?.setAttribute("d", "M" + toy.anchor.x + " " + toy.anchor.y + "L" + toy.xNow + " " + toy.yNow);
      positionButton(toy);
      const friend = buddy(toy);
      if (friend && !friend.classList.contains("playing")) friend.classList.add("playing");
      friend?.querySelectorAll(".awake-eyes").forEach((el) => { el.style.display = ""; });
      friend?.querySelectorAll(".sleep-eyes").forEach((el) => { el.style.display = "none"; });
      const matrix = svg.getScreenCTM();
      if (matrix) {
        const point = new DOMPoint(toy.xNow, toy.yNow).matrixTransform(matrix);
        friend?.querySelectorAll(".companion-pupil").forEach((pupil) => {
          const faceMatrix = pupil.parentElement.getScreenCTM();
          if (!faceMatrix) return;
          const local = point.matrixTransform(faceMatrix.inverse());
          const dx = local.x - Number(pupil.dataset.gazeX), dy = local.y - Number(pupil.dataset.gazeY);
          const distance = Math.hypot(dx, dy, 28);
          pupil.style.transform = "translate(" + (dx / distance * Number(pupil.dataset.gazeRangeX || 1.5)) + "px," + (dy / distance * Number(pupil.dataset.gazeRangeY || 1.1)) + "px)";
        });
      }
      if (toy.hand && friend) {
        const happy = Math.hypot(toy.xNow - toy.hand.x, toy.yNow - toy.hand.y) < 43;
        if (friend.classList.contains("snack-happy") !== happy) friend.classList.toggle("snack-happy", happy);
      }
    };
    const tick = (now) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      for (const [id, motion] of moving) {
        const next = stepToy(motion.toy, motion.state, dt);
        motion.state = next;
        Object.assign(motion.toy, { xNow: next.x, yNow: next.y, rotation: next.rotation });
        paint(motion.toy);
        if (next.settled) {
          moving.delete(id);
          resting.set(id, window.setTimeout(() => { resetBuddy(motion.toy); resting.delete(id); }, 450));
        }
      }
      host.dataset.settling = moving.size ? "true" : "false";
      if (!moving.size && !activeDrag && !host.contains(document.activeElement) && area) area.hidden = true;
      frame = moving.size ? requestAnimationFrame(tick) : 0;
    };
    const stopToy = (toy) => {
      moving.delete(toy.id);
      window.clearTimeout(resting.get(toy.id));
      resting.delete(toy.id);
    };
    const move = (toy, x, y, pointer = false) => {
      stopToy(toy);
      const bounds = toyBounds(toy);
      toy.xNow = clamp(x, bounds.left, bounds.right);
      toy.yNow = clamp(y, bounds.top, bounds.bottom);
      if (pointer) {
        const now = performance.now();
        if (toy.sample) {
          const dt = Math.max(.008, (now - toy.sample.time) / 1000);
          toy.velocity = { x: clamp((toy.xNow - toy.sample.x) / dt, -350, 350), y: clamp((toy.yNow - toy.sample.y) / dt, -350, 350) };
        }
        toy.sample = { x: toy.xNow, y: toy.yNow, time: now };
      }
      showArea(toy);
      paint(toy);
    };
    const release = (toy) => {
      if (!reactions) return;
      const velocity = toy.sample && performance.now() - toy.sample.time < 100 ? toy.velocity : {};
      moving.set(toy.id, { toy, state: releaseState(toy, { x: toy.xNow, y: toy.yNow, rotation: toy.rotation }, velocity) });
      host.dataset.settling = "true";
      if (!frame) { lastTime = performance.now(); frame = requestAnimationFrame(tick); }
    };
    controller.current = {
      focus: (id) => showArea(toys.find((toy) => toy.id === id)),
      blur: () => { if (!activeDrag && !moving.size && area) area.hidden = true; },
      down: (id, event) => {
        if (!reactions || activeDrag) return;
        event.preventDefault();
        const toy = toys.find((entry) => entry.id === id);
        stopToy(toy);
        toy.sample = null;
        toy.velocity = {};
        activeDrag = { toy, pointer: event.pointerId };
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        showArea(toy);
      },
      drag: (event) => {
        if (!activeDrag || activeDrag.pointer !== event.pointerId) return;
        const matrix = svg.getScreenCTM();
        if (!matrix) return;
        const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        move(activeDrag.toy, local.x, local.y, true);
      },
      up: (event) => {
        if (!activeDrag || activeDrag.pointer !== event.pointerId) return;
        const { toy } = activeDrag;
        activeDrag = null;
        release(toy);
      },
      key: (id, event, released) => {
        if (!reactions || !KEYS.includes(event.key) || activeDrag) return;
        event.preventDefault();
        const toy = toys.find((entry) => entry.id === id);
        toy.sample = null;
        if (released) return release(toy);
        move(toy, toy.xNow + (event.key === "ArrowLeft" ? -10 : event.key === "ArrowRight" ? 10 : ["Enter", " "].includes(event.key) ? -8 : 0), toy.yNow + (event.key === "ArrowDown" ? 10 : ["ArrowUp", "Enter", " "].includes(event.key) ? -8 : 0));
      },
    };
    const resize = new ResizeObserver(() => toys.forEach(positionButton));
    resize.observe(host);
    toys.forEach((toy) => { paint(toy); resetBuddy(toy); });
    return () => {
      controller.current = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
      resting.forEach((timer) => window.clearTimeout(timer));
      toys.forEach((toy) => {
        const target = button(toy);
        if (activeDrag?.toy === toy && target?.hasPointerCapture(activeDrag.pointer)) target.releasePointerCapture(activeDrag.pointer);
        resetBuddy(toy);
      });
      if (area) area.hidden = true;
      host.dataset.settling = "false";
    };
  }, [scene, prefix, reactions]);

  return <div ref={stage} className={"companion-scene companion-scene--" + theme} data-side={side || "both"} data-reactions={reactions} style={{ aspectRatio: scene.viewBox[2] + " / " + scene.viewBox[3] }}>
    <svg className="companion-art" viewBox={scene.viewBox.join(" ")} aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
    {reactions && <>
      <span className="companion-drag-area" hidden aria-hidden="true" />
      <span className="sr-only" id={descriptionId}>{APPEARANCE_COPY.toyHelp}</span>
      {scene.toys.map((toy) => <button key={toy.id} type="button" className="companion-interaction" data-toy={toy.id} aria-label={APPEARANCE_COPY.toys[toy.kind]} aria-describedby={descriptionId}
        onFocus={() => controller.current?.focus(toy.id)} onBlur={() => controller.current?.blur()}
        onPointerDown={(event) => controller.current?.down(toy.id, event)} onPointerMove={(event) => controller.current?.drag(event)}
        onPointerUp={(event) => controller.current?.up(event)} onPointerCancel={(event) => controller.current?.up(event)} onLostPointerCapture={(event) => controller.current?.up(event)}
        onKeyDown={(event) => controller.current?.key(toy.id, event, false)} onKeyUp={(event) => controller.current?.key(toy.id, event, true)} />)}
    </>}
  </div>;
}

export function CompanionFloor({ theme, reactions, ground = true }) {
  return <>
    {ground && <svg className={"companion-ground companion-ground--" + theme} viewBox="0 0 1280 32" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12Q160 0 320 12T640 12T960 12T1280 12V32H0Z" /></svg>}
    <div className={"companion-floor-inner companion-floor-inner--" + theme}>
      {theme === "cozy" ? <><CompanionScene theme={theme} side="left" reactions={reactions} /><CompanionScene theme={theme} side="right" reactions={reactions} /></> : <CompanionScene theme={theme} reactions={reactions} />}
    </div>
  </>;
}
