import React, { useEffect } from "react";
import { formatPickSlot } from "./draftRoomHelpers";
import { HubAlert } from "./HubUILayout";

const GRADE_LABEL = {
  steal: "Steal",
  great_value: "Great value",
  fair: "Fair price",
  slight_reach: "Slight reach",
  reach: "Reach",
  major_reach: "Major reach",
  pick: "Sold",
};

function recapAlertVariant(grade, isPick) {
  if (isPick) return "info";
  if (grade === "steal" || grade === "great_value") return "ready";
  if (grade === "major_reach") return "danger";
  if (grade === "reach" || grade === "slight_reach") return "warn";
  return "info";
}

export default function DraftPickRecap({ recap, onDismiss, pickDraft = false }) {
  useEffect(() => {
    if (!recap) return undefined;
    const id = setTimeout(() => onDismiss?.(), 4500);
    return () => clearTimeout(id);
  }, [recap, onDismiss]);

  if (!recap) return null;

  const grade = recap.value_grade || "pick";
  const isPick = Boolean(pickDraft || recap.pick_draft);
  const slot = formatPickSlot(recap);
  const title = isPick ? "Picked" : (GRADE_LABEL[grade] || "Pick");
  const who = [
    recap.team_name,
    recap.player_name ? `${recap.player_name} (${recap.position || "?"})` : null,
  ].filter(Boolean).join(" · ");
  const price = isPick
    ? (slot || "")
    : `$${Number(recap.amount).toFixed(0)}`;
  const detail = recap.value_blurb || recap.detail || "";

  return (
    <div className={`hub-pick-recap hub-pick-recap-${grade}`}>
      <HubAlert
        variant={recapAlertVariant(grade, isPick)}
        action={(
          <button type="button" className="btn-ghost btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      >
        <strong>{title}</strong>
        {who ? ` · ${who}` : ""}
        {price ? ` — ${price}` : ""}
        {detail ? ` · ${detail}` : ""}
      </HubAlert>
    </div>
  );
}
