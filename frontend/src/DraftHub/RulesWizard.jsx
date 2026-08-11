import React, { useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import {
  normalizeRiskTolerance,
  RISK_TOLERANCE_OPTIONS,
  riskToleranceLabel,
} from "../riskAdjustedValue";
import { HubPage } from "./HubUILayout";

const DEFAULT_RULES = {
  salary_cap: 200,
  risk_tolerance: 0,
  auction: { min_bid: 1, nomination_timer_sec: 60, bid_timer_sec: 30, allow_mid_draft_cuts: true },
  roster: {
    qb: { min: 2, max: 4, starter: 1 },
    rb: { min: 4, max: 8, starter: 2 },
    wr: { min: 4, max: 8, starter: 2 },
    te: { min: 1, max: 3, starter: 1 },
    k: { min: 0, max: 2, starter: 1 },
    def: { min: 0, max: 2, starter: 1 },
  },
  contracts: { max_years: 3, cut_refund_pct: 0.5, extension_step_up: 5 },
};

const ROSTER_LIMIT_KEYS = ["qb", "rb", "wr", "te", "k", "def"];

export default function RulesWizard({
  workspace,
  hubContext,
  presets,
  onSaved,
  embedded = false,
  readOnlyRules = false,
}) {
  const mobileLayout = useMobileLayout();
  const inLeague = hubContext?.mode === "league";
  const [name, setName] = useState("");
  const [season, setSeason] = useState(2025);
  const [rules, setRules] = useState(workspace?.rules || DEFAULT_RULES);
  const [presetId, setPresetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const formDirty = React.useRef(false);

  const applyServerState = React.useCallback(
    (ws, ctx) => {
      setName(inLeague ? (ctx?.league_name || ws?.name || "") : (ws?.name || ""));
      setSeason(Number(inLeague ? ctx?.season ?? ws?.season : ws?.season) ?? 2025);
      const incoming = (inLeague ? ctx?.rules : ws?.rules) || ws?.rules || DEFAULT_RULES;
      setRules({
        ...DEFAULT_RULES,
        ...incoming,
        roster: { ...DEFAULT_RULES.roster, ...(incoming.roster || {}) },
        auction: { ...DEFAULT_RULES.auction, ...(incoming.auction || {}) },
        contracts: { ...DEFAULT_RULES.contracts, ...(incoming.contracts || {}) },
      });
      formDirty.current = false;
    },
    [inLeague],
  );

  React.useEffect(() => {
    if (formDirty.current) return;
    applyServerState(workspace, hubContext);
  }, [
    workspace,
    hubContext,
    inLeague,
    hubContext?.league_id,
    hubContext?.season,
    hubContext?.league_name,
    applyServerState,
  ]);

  const updateCap = (v) => setRules((r) => ({ ...r, salary_cap: Number(v) }));
  const updateRiskTolerance = (v) =>
    setRules((r) => ({ ...r, risk_tolerance: normalizeRiskTolerance(v) }));
  const updateContract = (field, v) =>
    setRules((r) => ({
      ...r,
      contracts: { ...r.contracts, [field]: Number(v) },
    }));
  const updatePos = (pos, field, v) =>
    setRules((r) => ({
      ...r,
      roster: { ...r.roster, [pos]: { ...(r.roster?.[pos] || {}), [field]: Number(v) } },
    }));
  const updateAuction = (field, v) =>
    setRules((r) => ({
      ...r,
      auction: { ...r.auction, [field]: v },
    }));
  const activeRisk = normalizeRiskTolerance(rules.risk_tolerance);
  const activeRiskHint = RISK_TOLERANCE_OPTIONS.find((o) => o.value === activeRisk)?.hint;

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const body = { name, season, rules };
      if (presetId) body.preset_id = presetId;
      const res = await apiFetch("/api/hub/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      applyServerState(data, data.hub_context || hubContext);
      onSaved?.(data);
      setMsg("Saved to league.");
    } catch (e) {
      setMsg(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async (id) => {
    setPresetId(id);
    setSaving(true);
    try {
      const res = await apiFetch("/api/hub/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: id, name, season }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setRules(data.rules);
      onSaved?.(data);
      setMsg("Preset applied.");
    } catch (e) {
      setMsg(e.message || "Preset failed");
    } finally {
      setSaving(false);
      setPresetId("");
    }
  };

  const advanced = (
    <>
      <div className="hub-form-row">
        <label>
          <span className="hub-field-label">Max years</span>
          <input
            type="number"
            min={1}
            max={5}
            value={rules.contracts?.max_years ?? 3}
            onChange={(e) => updateContract("max_years", e.target.value)}
            disabled={readOnlyRules}
          />
        </label>
        <label>
          <span className="hub-field-label">Extension step-up ($/yr)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={rules.contracts?.extension_step_up ?? 5}
            onChange={(e) => updateContract("extension_step_up", e.target.value)}
            disabled={readOnlyRules}
          />
        </label>
        <label>
          <span className="hub-field-label">Cut refund (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round((rules.contracts?.cut_refund_pct ?? 0.5) * 100)}
            onChange={(e) => updateContract("cut_refund_pct", Number(e.target.value) / 100)}
            disabled={readOnlyRules}
          />
        </label>
      </div>
      <label className="hub-toggle-row">
        <input
          type="checkbox"
          checked={Boolean(rules.auction?.allow_mid_draft_cuts)}
          disabled={readOnlyRules}
          onChange={(e) => updateAuction("allow_mid_draft_cuts", e.target.checked)}
        />
        <span>Allow mid-draft cuts</span>
      </label>
      <div className="hub-limits-grid">
        {ROSTER_LIMIT_KEYS.map((pos) => (
          <div key={pos} className="hub-limit-card">
            <strong className="hub-limit-pos">{pos === "def" ? "DEF" : pos.toUpperCase()}</strong>
            <label className="hub-limit-field">
              <span className="hub-limit-field-label">Min</span>
              <input
                type="number"
                min={0}
                className="hub-limit-input"
                value={rules.roster?.[pos]?.min ?? 0}
                onChange={(e) => updatePos(pos, "min", e.target.value)}
                disabled={readOnlyRules}
              />
            </label>
            <label className="hub-limit-field">
              <span className="hub-limit-field-label">Max</span>
              <input
                type="number"
                min={0}
                className="hub-limit-input"
                value={rules.roster?.[pos]?.max ?? 0}
                onChange={(e) => updatePos(pos, "max", e.target.value)}
                disabled={readOnlyRules}
              />
            </label>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <HubPage className={`${embedded ? "hub-panel-embedded" : ""}${mobileLayout ? " hub-rules-wizard--mobile" : ""}`.trim()}>
      {!embedded && (
        <>
          <h2>League rules</h2>
          <h3 className="hub-panel-subtitle">League rules</h3>
        </>
      )}
      {readOnlyRules && <p className="chart-note">Managed by your commissioner.</p>}

      <div className="hub-form-row">
        <label>
          <span className="hub-field-label">League name</span>
          <input
            value={name}
            onChange={(e) => {
              formDirty.current = true;
              setName(e.target.value);
            }}
            placeholder="My auction league"
            disabled={readOnlyRules}
          />
        </label>
        <label>
          <span className="hub-field-label">Season</span>
          <input
            type="number"
            value={season}
            onChange={(e) => {
              formDirty.current = true;
              setSeason(Number(e.target.value));
            }}
            disabled={readOnlyRules}
          />
        </label>
        <label>
          <span className="hub-field-label">Salary cap ($)</span>
          <input
            type="number"
            value={rules.salary_cap}
            onChange={(e) => {
              formDirty.current = true;
              updateCap(e.target.value);
            }}
            disabled={readOnlyRules}
          />
        </label>
      </div>

      <div className="hub-risk-tolerance">
        <div className="hub-risk-tolerance-head">
          <span className="hub-field-label">Risk tolerance</span>
          <span className="chart-note">
            Fold season P10/P90 variance into suggested bids ({riskToleranceLabel(activeRisk)})
          </span>
        </div>
        <div
          className="header-segment hub-risk-tolerance-segment"
          role="radiogroup"
          aria-label="Auction risk tolerance"
        >
          {RISK_TOLERANCE_OPTIONS.map((opt) => {
            const selected = activeRisk === opt.value;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`header-segment-tab${selected ? " active" : ""}`}
                disabled={readOnlyRules}
                title={opt.hint}
                onClick={() => {
                  formDirty.current = true;
                  updateRiskTolerance(opt.value);
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {activeRiskHint && <p className="chart-note hub-risk-tolerance-hint">{activeRiskHint}</p>}
      </div>

      {presets.length > 0 && !readOnlyRules && (
        <div className="hub-preset-row">
          {presets.map((p) => (
            <button key={p.id} type="button" className="btn-ghost btn-sm" onClick={() => applyPreset(p.id)} disabled={saving}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {embedded ? (
        <details className="hub-setup-alt hub-setup-alt-nested">
          <summary>Contract & roster limits</summary>
          {advanced}
        </details>
      ) : (
        <>
          <h4 className="hub-section-title">Contract rules</h4>
          {advanced}
        </>
      )}

      {!readOnlyRules && (
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      )}
      {msg && <p className={`hub-status-msg${msg.startsWith("Saved") ? " hub-status-msg--ok" : ""}`}>{msg}</p>}
    </HubPage>
  );
}
