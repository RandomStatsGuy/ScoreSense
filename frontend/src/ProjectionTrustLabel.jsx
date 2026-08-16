import React from "react";
import { TRUST_LABEL } from "./playerContextDisplay";

const KIND_TO_TEXT = {
  included: TRUST_LABEL.INCLUDED,
  commentary: TRUST_LABEL.COMMENTARY,
  assumes_active: TRUST_LABEL.ASSUMES_ACTIVE,
};

/**
 * Explicit trust label for SCORE-24 — visible beside content, not metadata-only.
 */
export default function ProjectionTrustLabel({ kind, className = "" }) {
  const text = KIND_TO_TEXT[kind];
  if (!text) return null;
  return (
    <span
      className={`projection-trust-label projection-trust-label--${kind} ${className}`.trim()}
      role="note"
    >
      {text}
    </span>
  );
}
