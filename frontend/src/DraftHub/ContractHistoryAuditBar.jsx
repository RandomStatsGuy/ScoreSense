import React from "react";

const CATEGORY_LABELS = {
  salary: "Renewals",
  cuts: "Cuts / dead cap",
  waivers: "Waivers",
  post_draft_fa: "Post-draft FA",
  cap: "Cap / roster",
  ambiguous: "Ambiguous",
};

function patchableIssues(issues) {
  return (issues || []).filter(
    (i) => i.suggested_patch && Object.keys(i.suggested_patch).length > 0,
  );
}

export default function ContractHistoryAuditBar({
  audit,
  activeFilter,
  onFilterChange,
  onApplyAll,
  applying = false,
  isCommissioner = false,
}) {
  if (!audit?.summary) return null;

  const { total, by_category: byCategory } = audit.summary;
  const fixable = patchableIssues(audit.issues);

  if (total === 0) {
    return (
      <div className="hub-contract-audit-bar hub-contract-audit-bar--ok">
        <span className="hub-contract-audit-ok">No rule issues for this season.</span>
      </div>
    );
  }

  const categories = Object.entries(byCategory || {}).filter(([, n]) => n > 0);

  return (
    <div className="hub-contract-audit-bar">
      <div className="hub-contract-audit-summary">
        <strong>{total}</strong>
        <span> issue{total === 1 ? "" : "s"}</span>
      </div>
      <div className="hub-contract-audit-chips">
        <button
          type="button"
          className={`hub-contract-audit-chip${activeFilter === "issues" ? " hub-contract-audit-chip--active" : ""}`}
          onClick={() => onFilterChange(activeFilter === "issues" ? "" : "issues")}
        >
          All issues
        </button>
        {categories.map(([cat, count]) => (
          <button
            key={cat}
            type="button"
            className={`hub-contract-audit-chip${activeFilter === cat ? " hub-contract-audit-chip--active" : ""}`}
            onClick={() => onFilterChange(activeFilter === cat ? "" : cat)}
          >
            {CATEGORY_LABELS[cat] || cat}
            <span className="hub-contract-audit-chip-count">{count}</span>
          </button>
        ))}
      </div>
      {isCommissioner && fixable.length > 0 && (
        <button
          type="button"
          className="btn-primary btn-sm hub-contract-audit-apply"
          onClick={onApplyAll}
          disabled={applying}
        >
          {applying ? "Applying…" : `Apply ${fixable.length} fix${fixable.length === 1 ? "" : "es"}`}
        </button>
      )}
    </div>
  );
}

export { patchableIssues, CATEGORY_LABELS };
