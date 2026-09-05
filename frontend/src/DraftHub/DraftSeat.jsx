import React from "react";
import { seatModel } from "./draftSeat";

export default function DraftSeat({
  variant = "tile",
  slot,
  name,
  mine = false,
  taken = false,
  disabled = false,
  pressed = false,
  onClick,
}) {
  const model = seatModel({ mine, taken, name, slot, variant });
  const stateClass = `is-${model.state}`;
  if (variant === "mark") {
    const Tag = onClick ? "button" : "span";
    return (
      <Tag
        type={onClick ? "button" : undefined}
        className={`draft-seat draft-seat--mark mock-draft-seat${mine ? " is-human" : ""} ${stateClass}`}
        disabled={onClick ? disabled : undefined}
        onClick={onClick}
        aria-label={mine ? "Your seat" : `Seat ${model.who}`}
      >
        {model.who}
      </Tag>
    );
  }
  return (
    <button
      type="button"
      className={`draft-seat draft-seat--tile hub-pick-tile draft-lobby-slot ${stateClass}`}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className="draft-lobby-slot-num">{slot}</span>
      <span className="draft-lobby-slot-who">{model.who}</span>
      <span className="draft-lobby-slot-action">{model.action}</span>
    </button>
  );
}
