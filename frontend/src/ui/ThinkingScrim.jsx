import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export const THINK_SCENES = {
  insights: {
    title: "Putting the picture together",
    steps: [
      "Reading the cap sheet",
      "Checking how each team spent",
      "Lining up scoring and history",
    ],
  },
  mock: {
    title: "Setting up your practice draft",
    steps: [
      "Opening a private room",
      "Seating the bots",
      "Handing you the clock",
    ],
  },
  draft: {
    title: "Catching up with the room",
    steps: [
      "Rejoining the draft",
      "Syncing the latest bids",
      "Restoring your seat",
    ],
  },
};

export default function ThinkingScrim({
  show = false,
  scene = "draft",
  title,
  steps,
}) {
  const preset = THINK_SCENES[scene] || THINK_SCENES.draft;
  const heading = title || preset.title;
  const lines = (steps && steps.length ? steps : preset.steps);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!show) {
      setStepIndex(0);
      return undefined;
    }
    const timer = window.setInterval(() => {
      setStepIndex((i) => (i + 1) % Math.max(lines.length, 1));
    }, 1600);
    return () => window.clearInterval(timer);
  }, [show, lines.length]);

  if (!show || typeof document === "undefined") return null;

  return createPortal(
    <div className="ss-think-scrim" role="status" aria-live="polite" aria-busy="true">
      <div className="ss-think-card">
        <div className="ss-think-mark" aria-hidden="true">
          <span className="ss-think-pigskin" />
        </div>
        <p className="ss-think-kicker">Working</p>
        <h2 className="ss-think-title">{heading}</h2>
        <ul className="ss-think-steps">
          {lines.map((line, index) => (
            <li
              key={line}
              className={index === stepIndex ? "is-active" : index < stepIndex ? "is-done" : ""}
            >
              {line}
            </li>
          ))}
        </ul>
        <p className="ss-think-foot">This usually takes a few seconds.</p>
      </div>
    </div>,
    document.body,
  );
}
