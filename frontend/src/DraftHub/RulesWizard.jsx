import React, { useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import {
  normalizeRiskTolerance,
  RISK_TOLERANCE_OPTIONS,
  riskToleranceLabel,
} from "../riskAdjustedValue";
import { HubPage } from "./HubUILayout";
import { isPickDraft } from "./draftEntryStatus";
import {
  contractSchedule,
  DEFAULT_RULES,
  mergeLeagueRules,
  ROSTER_LIMIT_KEYS,
  RULES_COPY,
  rulesSummary,
  validateLeagueSettings,
} from "./rulesPresentation";

const FORMAT_OPTIONS = [
  { id: "auction", label: "Salary cap", hint: "Nominate and bid with contracts." },
  { id: "snake", label: "Snake", hint: "Pick order reverses each round." },
  { id: "linear", label: "Linear", hint: "The same order every round." },
];

function RuleError({ children }) {
  return children ? <span className="hub-rules-field-error">{children}</span> : null;
}

function PolicyToggle({ checked, disabled, title, description, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`hub-rules-policy${checked ? " is-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span>
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="hub-rules-switch" aria-hidden="true"><span /></span>
    </button>
  );
}

function SalarySchedule({ title, detail, values }) {
  return (
    <div className="hub-rules-schedule">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <ol aria-label={`${title} salary schedule`}>
        {values.map((value, index) => (
          <li key={`${title}-${index}`}>
            <span>Y{index + 1}</span>
            <strong>${Number(value).toLocaleString()}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function RulesWizard({
  workspace,
  hubContext,
  presets = [],
  onSaved,
  readOnlyRules = false,
}) {
  const inLeague = hubContext?.mode === "league";
  const [name, setName] = useState("");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [rules, setRules] = useState(() => mergeLeagueRules(workspace?.rules || DEFAULT_RULES));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ kind: "", text: "" });
  const formDirty = useRef(false);
  const sourceKeyRef = useRef("");

  const applyServerState = React.useCallback((ws, ctx) => {
    const leagueMode = ctx?.mode === "league";
    setName(leagueMode ? (ctx?.league_name || ws?.name || "") : (ws?.name || ""));
    setSeason(Number(leagueMode ? ctx?.season ?? ws?.season : ws?.season) || new Date().getFullYear());
    const incoming = (leagueMode ? ctx?.rules : ws?.rules) || ws?.rules || DEFAULT_RULES;
    setRules(mergeLeagueRules(incoming));
    formDirty.current = false;
  }, []);

  React.useEffect(() => {
    const sourceKey = inLeague
      ? `league:${hubContext?.league_id || ""}`
      : `workspace:${workspace?.id || ""}`;
    if (sourceKeyRef.current !== sourceKey) {
      sourceKeyRef.current = sourceKey;
      applyServerState(workspace, hubContext);
      return;
    }
    if (!formDirty.current) applyServerState(workspace, hubContext);
  }, [workspace, hubContext, inLeague, applyServerState]);

  const touch = () => {
    formDirty.current = true;
    if (status.text) setStatus({ kind: "", text: "" });
  };
  const updateRules = (updater) => {
    touch();
    setRules((current) => mergeLeagueRules(
      typeof updater === "function" ? updater(current) : updater,
    ));
  };
  const updateContract = (field, value) => updateRules((current) => ({
    ...current,
    contracts: { ...current.contracts, [field]: value },
  }));
  const updateAuction = (field, value) => updateRules((current) => ({
    ...current,
    auction: { ...current.auction, [field]: value },
  }));
  const updatePosition = (position, field, value) => updateRules((current) => ({
    ...current,
    roster: {
      ...current.roster,
      [position]: { ...current.roster[position], [field]: Number(value) },
    },
  }));

  const pickDraft = isPickDraft(rules);
  const errors = useMemo(
    () => validateLeagueSettings({ name, season, rules }),
    [name, season, rules],
  );
  const summary = useMemo(() => rulesSummary(rules), [rules]);
  const activeRisk = normalizeRiskTolerance(rules.risk_tolerance);
  const activeRiskHint = RISK_TOLERANCE_OPTIONS.find((option) => option.value === activeRisk)?.hint;
  const rookieSchedule = contractSchedule(
    10,
    rules.contracts.rookie_years,
    rules.contracts.extension_step_up,
    rules.contracts.rookie_salary_static,
  );
  const veteranSchedule = contractSchedule(
    10,
    rules.contracts.veteran_years,
    rules.contracts.extension_step_up,
  );

  const save = async () => {
    if (Object.keys(errors).length > 0) {
      setStatus({ kind: "error", text: "Fix the highlighted rules before saving." });
      return;
    }
    setSaving(true);
    setStatus({ kind: "", text: "" });
    try {
      const res = await apiFetch("/api/hub/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), season, rules }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      applyServerState(data, data.hub_context || hubContext);
      onSaved?.(data);
      setStatus({ kind: "ok", text: "Rules saved. Everyone now sees the same league policy." });
    } catch (error) {
      setStatus({ kind: "error", text: error.message || "Rules could not be saved." });
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async (presetId) => {
    setSaving(true);
    setStatus({ kind: "", text: "" });
    try {
      const res = await apiFetch("/api/hub/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: presetId, name: name.trim(), season }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      applyServerState(data, data.hub_context || hubContext);
      onSaved?.(data);
      setStatus({ kind: "ok", text: "Template applied and saved." });
    } catch (error) {
      setStatus({ kind: "error", text: error.message || "Template could not be applied." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <HubPage className="hub-rules-center">
      <header className="hub-rules-hero">
        <div>
          <span className="hub-rules-eyebrow">{RULES_COPY.eyebrow}</span>
          <h2>{RULES_COPY.heading}</h2>
          <p>{RULES_COPY.support}</p>
        </div>
        <span className={`hub-rules-access${readOnlyRules ? " is-readonly" : ""}`}>
          {readOnlyRules ? "Commissioner managed" : "You can edit"}
        </span>
      </header>

      <div className="hub-rules-layout">
        <div className="hub-rules-sections">
          <section className="hub-rules-section" aria-labelledby="rules-foundation-title">
            <header className="hub-rules-section-head">
              <span>01</span>
              <div>
                <h3 id="rules-foundation-title">League foundation</h3>
                <p>The identity and format managers see everywhere in Fantasy.</p>
              </div>
            </header>

            <div className="hub-rules-field-grid hub-rules-field-grid--foundation">
              <label>
                <span>League name</span>
                <input
                  value={name}
                  disabled={readOnlyRules}
                  onChange={(event) => {
                    touch();
                    setName(event.target.value);
                  }}
                />
                <RuleError>{errors.name}</RuleError>
              </label>
              <label>
                <span>Season</span>
                <input
                  type="number"
                  min="2020"
                  max="2100"
                  value={season}
                  disabled={readOnlyRules}
                  onChange={(event) => {
                    touch();
                    setSeason(Number(event.target.value));
                  }}
                />
                <RuleError>{errors.season}</RuleError>
              </label>
              {!pickDraft && (
                <label>
                  <span>Team salary cap</span>
                  <span className="hub-rules-money-input">
                    <span>$</span>
                    <input
                      type="number"
                      min="1"
                      value={rules.salary_cap}
                      disabled={readOnlyRules}
                      onChange={(event) => updateRules((current) => ({
                        ...current,
                        salary_cap: Number(event.target.value),
                      }))}
                    />
                  </span>
                  <RuleError>{errors.salary_cap}</RuleError>
                </label>
              )}
            </div>

            <fieldset className="hub-rules-format">
              <legend>Draft format</legend>
              <div>
                {FORMAT_OPTIONS.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    className={rules.draft_type === format.id ? "is-active" : ""}
                    aria-pressed={rules.draft_type === format.id}
                    disabled={readOnlyRules}
                    onClick={() => updateRules((current) => ({ ...current, draft_type: format.id }))}
                  >
                    <strong>{format.label}</strong>
                    <span>{format.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {!pickDraft && (
              <div className="hub-rules-risk">
                <div>
                  <strong>Risk posture</strong>
                  <span>How projection uncertainty influences suggested bids.</span>
                </div>
                <div className="hub-rules-risk-options" role="radiogroup" aria-label="Risk posture">
                  {RISK_TOLERANCE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={activeRisk === option.value}
                      className={activeRisk === option.value ? "is-active" : ""}
                      disabled={readOnlyRules}
                      onClick={() => updateRules((current) => ({
                        ...current,
                        risk_tolerance: normalizeRiskTolerance(option.value),
                      }))}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <small>{riskToleranceLabel(activeRisk)} · {activeRiskHint}</small>
              </div>
            )}
          </section>

          {!pickDraft && (
            <section className="hub-rules-section" aria-labelledby="rules-contracts-title">
              <header className="hub-rules-section-head">
                <span>02</span>
                <div>
                  <h3 id="rules-contracts-title">Contract lifecycle</h3>
                  <p>Define how new deals grow and who can stay beyond the original term.</p>
                </div>
              </header>

              <div className="hub-rules-field-grid hub-rules-field-grid--contracts">
                <label>
                  <span>Max extension length</span>
                  <select value={rules.contracts.max_years} disabled={readOnlyRules} onChange={(event) => updateContract("max_years", Number(event.target.value))}>
                    {[1, 2, 3, 4, 5].map((years) => <option key={years} value={years}>{years} year{years === 1 ? "" : "s"}</option>)}
                  </select>
                  <RuleError>{errors.max_years}</RuleError>
                </label>
                <label>
                  <span>Annual salary step-up</span>
                  <span className="hub-rules-money-input">
                    <span>$</span>
                    <input type="number" min="0" value={rules.contracts.extension_step_up} disabled={readOnlyRules} onChange={(event) => updateContract("extension_step_up", Number(event.target.value))} />
                  </span>
                  <RuleError>{errors.extension_step_up}</RuleError>
                </label>
                <label>
                  <span>Default rookie term</span>
                  <select value={rules.contracts.rookie_years} disabled={readOnlyRules} onChange={(event) => updateContract("rookie_years", Number(event.target.value))}>
                    {[1, 2, 3, 4, 5].map((years) => <option key={years} value={years}>{years} year{years === 1 ? "" : "s"}</option>)}
                  </select>
                  <RuleError>{errors.rookie_years}</RuleError>
                </label>
                <label>
                  <span>Default veteran term</span>
                  <select value={rules.contracts.veteran_years} disabled={readOnlyRules} onChange={(event) => updateContract("veteran_years", Number(event.target.value))}>
                    {[1, 2, 3, 4, 5].map((years) => <option key={years} value={years}>{years} year{years === 1 ? "" : "s"}</option>)}
                  </select>
                  <RuleError>{errors.veteran_years}</RuleError>
                </label>
                <label>
                  <span>Cut refund</span>
                  <span className="hub-rules-suffix-input">
                    <input type="number" min="0" max="100" value={Math.round(Number(rules.contracts.cut_refund_pct) * 100)} disabled={readOnlyRules} onChange={(event) => updateContract("cut_refund_pct", Number(event.target.value) / 100)} />
                    <span>%</span>
                  </span>
                  <RuleError>{errors.cut_refund_pct}</RuleError>
                </label>
              </div>

              <div className="hub-rules-policies">
                <PolicyToggle checked={Boolean(rules.contracts.rookie_salary_static)} disabled={readOnlyRules} title="Keep rookie salaries flat" description="Every year of a rookie deal keeps the draft-day salary." onChange={(value) => updateContract("rookie_salary_static", value)} />
                <PolicyToggle checked={Boolean(rules.contracts.one_renewal_after_rookie)} disabled={readOnlyRules} title="Allow one rookie extension" description="Final-year rookies may move onto one extension before free agency." onChange={(value) => updateContract("one_renewal_after_rookie", value)} />
                <PolicyToggle checked={Boolean(rules.contracts.allow_veteran_renewal)} disabled={readOnlyRules} title="Allow veteran extensions" description="Final-year veterans may be renewed instead of returning to the pool." onChange={(value) => updateContract("allow_veteran_renewal", value)} />
              </div>

              <div className="hub-rules-contract-preview">
                <div className="hub-rules-contract-preview-head">
                  <div><strong>What a $10 signing looks like</strong><span>Preview uses the rules above.</span></div>
                  <span>New contracts only</span>
                </div>
                <div>
                  <SalarySchedule title="Rookie" detail={rules.contracts.rookie_salary_static ? "Flat salary" : "Annual step-up"} values={rookieSchedule} />
                  <SalarySchedule title="Veteran" detail="Annual step-up" values={veteranSchedule} />
                </div>
                <p>Saving these rules does not rewrite existing contract schedules.</p>
              </div>
            </section>
          )}

          <section className="hub-rules-section" aria-labelledby="rules-roster-title">
            <header className="hub-rules-section-head">
              <span>{pickDraft ? "02" : "03"}</span>
              <div>
                <h3 id="rules-roster-title">Roster shape</h3>
                <p>Use ranges to protect lineup integrity without dictating strategy.</p>
              </div>
            </header>
            <label className="hub-rules-roster-cap">
              <span><strong>Total roster size</strong><small>Maximum active players per team. Leave empty to let position limits set the cap.</small></span>
              <input
                type="number"
                min="1"
                max="100"
                value={rules.roster_size_max ?? ""}
                placeholder="No cap"
                disabled={readOnlyRules}
                onChange={(event) => updateRules((current) => ({
                  ...current,
                  roster_size_max: event.target.value === "" ? null : Number(event.target.value),
                }))}
              />
              <RuleError>{errors.roster_size_max}</RuleError>
            </label>
            <div className="hub-rules-roster-table" role="group" aria-label="Position limits">
              <div className="hub-rules-roster-heading" aria-hidden="true"><span>Position</span><span>Minimum</span><span>Maximum</span></div>
              {ROSTER_LIMIT_KEYS.map((position) => (
                <div className="hub-rules-roster-row" key={position}>
                  <strong>{position === "def" ? "DEF" : position.toUpperCase()}</strong>
                  <label><span className="sr-only">{position.toUpperCase()} minimum</span><input type="number" min="0" value={rules.roster[position]?.min ?? 0} disabled={readOnlyRules} onChange={(event) => updatePosition(position, "min", event.target.value)} /></label>
                  <label><span className="sr-only">{position.toUpperCase()} maximum</span><input type="number" min="0" value={rules.roster[position]?.max ?? 0} disabled={readOnlyRules} onChange={(event) => updatePosition(position, "max", event.target.value)} /></label>
                  <RuleError>{errors[`roster_${position}`]}</RuleError>
                </div>
              ))}
            </div>
          </section>

          {!pickDraft && (
            <details className="hub-rules-section hub-rules-advanced">
              <summary><span>04</span><span><strong>Draft behavior</strong><small>Clock and nomination defaults</small></span></summary>
              <div className="hub-rules-field-grid hub-rules-field-grid--draft">
                <label><span>Minimum bid</span><input type="number" min="1" value={rules.auction.min_bid} disabled={readOnlyRules} onChange={(event) => updateAuction("min_bid", Number(event.target.value))} /></label>
                <label><span>Nomination clock</span><input type="number" min="5" value={rules.auction.nomination_timer_sec} disabled={readOnlyRules} onChange={(event) => updateAuction("nomination_timer_sec", Number(event.target.value))} /></label>
                <label><span>Bid clock</span><input type="number" min="5" value={rules.auction.bid_timer_sec} disabled={readOnlyRules} onChange={(event) => updateAuction("bid_timer_sec", Number(event.target.value))} /></label>
                <label><span>Late-bid extension</span><input type="number" min="0" value={rules.auction.bid_extension_sec} disabled={readOnlyRules} onChange={(event) => updateAuction("bid_extension_sec", Number(event.target.value))} /></label>
              </div>
              <PolicyToggle checked={Boolean(rules.auction.allow_mid_draft_cuts)} disabled={readOnlyRules} title="Allow mid-draft cuts" description="Managers may release a drafted player while the auction is still running." onChange={(value) => updateAuction("allow_mid_draft_cuts", value)} />
            </details>
          )}

          {!readOnlyRules && (
            <div className="hub-rules-sticky-save">
              <button type="button" className="btn-primary" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save league rules"}
              </button>
            </div>
          )}

          {presets.length > 0 && !readOnlyRules && (
            <details className="hub-rules-templates">
              <summary>Start over from a league template</summary>
              <p>Applying a template replaces the current rules and saves immediately.</p>
              <div>{presets.map((preset) => <button key={preset.id} type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => applyPreset(preset.id)}>{preset.label}</button>)}</div>
            </details>
          )}
        </div>

        <aside className="hub-rules-summary" aria-label="League rule summary">
          <div><span className="hub-rules-eyebrow">At a glance</span><h3>{name || "Your league"}</h3><p>{season} season</p></div>
          <dl>{summary.map((item) => <div key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          <p className="hub-rules-summary-note">Managers can read these rules here. Only commissioners can change them.</p>
          {!readOnlyRules && <button type="button" className="btn-primary hub-rules-save" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save league rules"}</button>}
          {status.text && <p className={`hub-rules-status is-${status.kind}`} role="status" aria-live="polite">{status.text}</p>}
        </aside>
      </div>
    </HubPage>
  );
}
