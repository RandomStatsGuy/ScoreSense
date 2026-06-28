/** Shared pill badge — sentiment, injury, team, network labels. */
const TONE_CLASS = {
  positive: "chip-positive",
  negative: "chip-negative",
  mixed: "chip-mixed",
  neutral: "chip-neutral",
  caution: "chip-caution",
  severe: "chip-severe",
  doubtful: "chip-doubtful",
  questionable: "chip-questionable",
  probable: "chip-probable",
  default: "chip-default",
  team: "chip-team",
};

export function injuryChipTone(status) {
  const s = String(status || "").toLowerCase();
  if (/(out|ir|pup|inactive|suspended)/.test(s)) return "severe";
  if (s.includes("doubtful")) return "doubtful";
  if (s.includes("questionable")) return "questionable";
  if (s.includes("probable")) return "probable";
  return "default";
}

export function sentimentChipTone(label) {
  const l = String(label || "").toLowerCase();
  if (l.includes("bull")) return "positive";
  if (l.includes("bear")) return "negative";
  if (l.includes("mixed")) return "mixed";
  return "neutral";
}

export default function Chip({ tone = "default", className = "", children, ...rest }) {
  const toneClass = TONE_CLASS[tone] || TONE_CLASS.default;
  return (
    <span className={`chip ${toneClass} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
