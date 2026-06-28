import React, { useEffect } from "react";

const GRADE_LABEL = {
  steal: "Steal",
  great_value: "Great value",
  fair: "Fair price",
  slight_reach: "Slight reach",
  reach: "Reach",
  major_reach: "Major reach",
  pick: "Sold",
};

export default function DraftPickRecap({ recap, onDismiss }) {
  useEffect(() => {
    if (!recap) return undefined;
    const id = setTimeout(() => onDismiss?.(), 9000);
    return () => clearTimeout(id);
  }, [recap, onDismiss]);

  if (!recap) return null;

  const grade = recap.value_grade || "pick";

  return (
    <div className={`hub-pick-recap hub-pick-recap-${grade}`} role="status">
      <div className="hub-pick-recap-head">
        <strong>{GRADE_LABEL[grade] || "Pick"}</strong>
        <button type="button" className="btn-ghost btn-sm" onClick={onDismiss}>Dismiss</button>
      </div>
      <p className="hub-pick-recap-player">
        {recap.team_name ? `${recap.team_name} · ` : ""}
        {recap.player_name} ({recap.position}) — ${Number(recap.amount).toFixed(0)}
      </p>
      <p className="hub-pick-recap-detail">{recap.value_blurb || recap.detail}</p>
    </div>
  );
}
