import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import {
  normalizeRiskTolerance,
  RISK_TOLERANCE_OPTIONS,
  riskToleranceLabel,
} from "../riskAdjustedValue";
import { confirmDialog } from "../ui/confirm";
import { isHubRulesPath, setUnsavedNavigationBlocker } from "../unsavedNavigation";
import { HubFilterMenu, HubPage } from "./HubUILayout";
import { isPickDraft } from "./draftEntryStatus";
import {
  contractSchedule,
  DEFAULT_RULES,
  FORMAT_OPTIONS,
  formatLastSaved,
  glanceEyebrow,
  mergeLeagueRules,
  presetRulesFromList,
  ROSTER_LIMIT_KEYS,
  RULES_COPY,
  rulesFormWarnings,
  rulesSaveDisabledReason,
  rulesSummary,
  snapshotRulesForm,
  templateConfirmMessage,
  validateLeagueSettings,
} from "./rulesPresentation";

function RuleError({ id, children }) {
  if (!children) return null;
  return (
    <span id={id} className="hub-rules-field-error" role="alert">
      {children}
    </span>
  );
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

function fieldDescribedBy(id, error) {
  return error ? id : undefined;
}

export default function RulesWizard({
  workspace,
  hubContext,
  presets = [],
  roster = [],
  onSaved,
  readOnlyRules = false,
}) {
  const inLeague = hubContext?.mode === "league";
  const [name, setName] = useState("");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [rules, setRules] = useState(() => mergeLeagueRules(workspace?.rules || DEFAULT_RULES));
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshotRulesForm({
    name: "",
    season: new Date().getFullYear(),
    rules: mergeLeagueRules(workspace?.rules || DEFAULT_RULES),
  }));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ kind: "", text: "" });
  const [savedAt, setSavedAt] = useState(null);
  const [undo, setUndo] = useState(null);
  const sourceKeyRef = useRef("");
  const dirtyRef = useRef(false);

  const applyServerState = React.useCallback((ws, ctx) => {
    const leagueMode = ctx?.mode === "league";
    const nextName = leagueMode ? (ctx?.league_name || ws?.name || "") : (ws?.name || "");
    const nextSeason = Number(leagueMode ? ctx?.season ?? ws?.season : ws?.season) || new Date().getFullYear();
    const incoming = (leagueMode ? ctx?.rules : ws?.rules) || ws?.rules || DEFAULT_RULES;
    const nextRules = mergeLeagueRules(incoming);
    setName(nextName);
    setSeason(nextSeason);
    setRules(nextRules);
    setSavedSnapshot(snapshotRulesForm({ name: nextName, season: nextSeason, rules: nextRules }));
    setUndo(null);
  }, []);

  useEffect(() => {
    const sourceKey = inLeague
      ? `league:${hubContext?.league_id || ""}`
      : `workspace:${workspace?.id || ""}`;
    if (sourceKeyRef.current !== sourceKey) {
      sourceKeyRef.current = sourceKey;
      applyServerState(workspace, hubContext);
      return;
    }
    if (!dirtyRef.current) applyServerState(workspace, hubContext);
  }, [workspace, hubContext, inLeague, applyServerState]);

  const formSnapshot = snapshotRulesForm({ name, season, rules });
  const dirty = formSnapshot !== savedSnapshot;
  dirtyRef.current = dirty;

  const touch = () => {
    if (status.text) setStatus({ kind: "", text: "" });
    if (undo) setUndo(null);
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
  const warnings = useMemo(
    () => rulesFormWarnings({ rules, roster }),
    [rules, roster],
  );
  const warningList = Object.values(warnings);
  const errorCount = Object.keys(errors).length;
  const saveReason = rulesSaveDisabledReason({ dirty, saving, errorCount });
  const saveDisabled = Boolean(saving || saveReason);
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
  const lastSavedLabel = RULES_COPY.lastSaved(formatLastSaved(savedAt));

  useEffect(() => {
    setUnsavedNavigationBlocker(async (nextPath) => {
      if (!dirtyRef.current || readOnlyRules) return true;
      if (isHubRulesPath(nextPath)) return true;
      return confirmDialog({
        title: RULES_COPY.leaveTitle,
        message: RULES_COPY.leaveUnsaved,
        confirmLabel: RULES_COPY.leaveConfirm,
        cancelLabel: RULES_COPY.keepEditing,
        danger: true,
      });
    });
    return () => setUnsavedNavigationBlocker(null);
  }, [readOnlyRules]);

  useEffect(() => {
    if (!dirtyRef.current || readOnlyRules) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [name, season, rules, readOnlyRules]);

  const save = async () => {
    if (errorCount > 0) {
      setStatus({ kind: "error", text: RULES_COPY.fixBeforeSave });
      return;
    }
    if (!dirtyRef.current) return;
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
      setSavedAt(new Date());
      setStatus({ kind: "ok", text: RULES_COPY.saved });
    } catch (error) {
      setStatus({ kind: "error", text: error.message || RULES_COPY.saveFailed });
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = async (preset) => {
    const nextRules = presetRulesFromList(preset);
    if (!nextRules) {
      setStatus({ kind: "error", text: RULES_COPY.templateMissing });
      return;
    }
    const ok = await confirmDialog({
      title: RULES_COPY.templateConfirmTitle(preset.label),
      message: templateConfirmMessage(preset, rules),
      confirmLabel: RULES_COPY.templateConfirm,
      cancelLabel: RULES_COPY.keepEditing,
      danger: true,
    });
    if (!ok) return;
    setUndo({
      name,
      season,
      rules,
      label: preset.label,
    });
    setRules(nextRules);
    setStatus({ kind: "", text: "" });
  };

  const undoTemplate = () => {
    if (!undo) return;
    setName(undo.name);
    setSeason(undo.season);
    setRules(mergeLeagueRules(undo.rules));
    setUndo(null);
    setStatus({ kind: "", text: "" });
  };

  const saveControls = !readOnlyRules && (
    <>
      <p className="hub-rules-summary-note">{RULES_COPY.saveFootnote}</p>
      <button
        type="button"
        className="btn-primary hub-rules-save"
        disabled={saveDisabled}
        onClick={save}
      >
        {saving ? RULES_COPY.saving : RULES_COPY.save}
      </button>
      {saveReason ? <p className="hub-rules-save-reason">{saveReason}</p> : null}
      {lastSavedLabel ? <p className="hub-rules-last-saved">{lastSavedLabel}</p> : null}
    </>
  );

  return (
    <HubPage className="hub-rules-center">
      <header className="hub-rules-hero">
        <div>
          <span className="hub-rules-eyebrow">{RULES_COPY.eyebrow}</span>
          <h2>{RULES_COPY.heading}</h2>
          <p>{RULES_COPY.support}</p>
        </div>
        {readOnlyRules ? (
          <span className="hub-rules-access is-readonly">{RULES_COPY.commissionerManaged}</span>
        ) : null}
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
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={fieldDescribedBy("rules-name-error", errors.name)}
                  onChange={(event) => {
                    touch();
                    setName(event.target.value);
                  }}
                />
                <RuleError id="rules-name-error">{errors.name}</RuleError>
              </label>
              <label>
                <span>Season</span>
                <input
                  type="number"
                  min="2020"
                  max="2100"
                  value={season}
                  disabled={readOnlyRules}
                  aria-invalid={Boolean(errors.season)}
                  aria-describedby={fieldDescribedBy("rules-season-error", errors.season)}
                  onChange={(event) => {
                    touch();
                    setSeason(Number(event.target.value));
                  }}
                />
                <RuleError id="rules-season-error">{errors.season}</RuleError>
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
                      aria-invalid={Boolean(errors.salary_cap)}
                      aria-describedby={fieldDescribedBy("rules-cap-error", errors.salary_cap)}
                      onChange={(event) => updateRules((current) => ({
                        ...current,
                        salary_cap: Number(event.target.value),
                      }))}
                    />
                  </span>
                  <RuleError id="rules-cap-error">{errors.salary_cap}</RuleError>
                </label>
              )}
            </div>

            <fieldset className="hub-rules-format">
              <legend>Draft format</legend>
              <div role="radiogroup" aria-label="Draft format">
                {FORMAT_OPTIONS.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    role="radio"
                    aria-checked={rules.draft_type === format.id}
                    className={rules.draft_type === format.id ? "is-active" : ""}
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
                  <HubFilterMenu
                    label="Years"
                    value={String(rules.contracts.max_years)}
                    disabled={readOnlyRules}
                    options={[1, 2, 3, 4, 5].map((years) => ({
                      id: String(years),
                      label: `${years} year${years === 1 ? "" : "s"}`,
                    }))}
                    onChange={(id) => updateContract("max_years", Number(id))}
                  />
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
                  <HubFilterMenu
                    label="Years"
                    value={String(rules.contracts.rookie_years)}
                    disabled={readOnlyRules}
                    options={[1, 2, 3, 4, 5].map((years) => ({
                      id: String(years),
                      label: `${years} year${years === 1 ? "" : "s"}`,
                    }))}
                    onChange={(id) => updateContract("rookie_years", Number(id))}
                  />
                  <RuleError>{errors.rookie_years}</RuleError>
                </label>
                <label>
                  <span>Default veteran term</span>
                  <HubFilterMenu
                    label="Years"
                    value={String(rules.contracts.veteran_years)}
                    disabled={readOnlyRules}
                    options={[1, 2, 3, 4, 5].map((years) => ({
                      id: String(years),
                      label: `${years} year${years === 1 ? "" : "s"}`,
                    }))}
                    onChange={(id) => updateContract("veteran_years", Number(id))}
                  />
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
                </div>
                <div>
                  <SalarySchedule title="Rookie" detail={rules.contracts.rookie_salary_static ? "Flat salary" : "Annual step-up"} values={rookieSchedule} />
                  <SalarySchedule title="Veteran" detail="Annual step-up" values={veteranSchedule} />
                </div>
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
            {warningList.length > 0 && (
              <div className="hub-rules-warnings" role="status">
                {warningList.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}
            <label className="hub-rules-roster-cap">
              <span><strong>Total roster size</strong><small>Maximum active players per team. Leave empty to let position limits set the cap.</small></span>
              <input
                type="number"
                min="0"
                max="100"
                value={rules.roster_size_max ?? ""}
                placeholder="No cap"
                disabled={readOnlyRules}
                aria-invalid={Boolean(errors.roster_size_max)}
                aria-describedby={fieldDescribedBy("rules-roster-cap-error", errors.roster_size_max)}
                onChange={(event) => updateRules((current) => ({
                  ...current,
                  roster_size_max: event.target.value === "" ? null : Number(event.target.value),
                }))}
              />
              <RuleError id="rules-roster-cap-error">{errors.roster_size_max}</RuleError>
            </label>
            <div className="hub-rules-roster-table" role="table" aria-label="Position limits">
              <div className="hub-rules-roster-heading" role="row">
                <span role="columnheader">{RULES_COPY.rosterPosition}</span>
                <span role="columnheader">{RULES_COPY.rosterMin}</span>
                <span role="columnheader">{RULES_COPY.rosterMax}</span>
              </div>
              {ROSTER_LIMIT_KEYS.map((position) => (
                <div className="hub-rules-roster-row" role="row" key={position}>
                  <strong role="rowheader">{position === "def" ? "DEF" : position.toUpperCase()}</strong>
                  <label>
                    <span className="sr-only">{position.toUpperCase()} minimum</span>
                    <input
                      type="number"
                      min="0"
                      value={rules.roster[position]?.min ?? 0}
                      disabled={readOnlyRules}
                      aria-invalid={Boolean(errors[`roster_${position}`])}
                      onChange={(event) => updatePosition(position, "min", event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="sr-only">{position.toUpperCase()} maximum</span>
                    <input
                      type="number"
                      min="0"
                      value={rules.roster[position]?.max ?? 0}
                      disabled={readOnlyRules}
                      aria-invalid={Boolean(errors[`roster_${position}`])}
                      onChange={(event) => updatePosition(position, "max", event.target.value)}
                    />
                  </label>
                  <RuleError>{errors[`roster_${position}`]}</RuleError>
                </div>
              ))}
            </div>
          </section>

          {!pickDraft && (
            <section className="hub-rules-section" aria-labelledby="rules-draft-title">
              <header className="hub-rules-section-head">
                <span>04</span>
                <div>
                  <h3 id="rules-draft-title">Draft behavior</h3>
                  <p>{RULES_COPY.draftBehaviorHint}</p>
                </div>
              </header>
              <div className="hub-rules-field-grid hub-rules-field-grid--draft">
                <label>
                  <span>Minimum bid</span>
                  <span className="hub-rules-money-input">
                    <span>$</span>
                    <input
                      type="number"
                      min="1"
                      value={rules.auction.min_bid}
                      disabled={readOnlyRules}
                      aria-invalid={Boolean(errors.min_bid)}
                      onChange={(event) => updateAuction("min_bid", Number(event.target.value))}
                    />
                  </span>
                  <RuleError>{errors.min_bid}</RuleError>
                </label>
                <label>
                  <span>Nomination clock</span>
                  <span className="hub-rules-suffix-input">
                    <input
                      type="number"
                      min="5"
                      value={rules.auction.nomination_timer_sec}
                      disabled={readOnlyRules}
                      aria-invalid={Boolean(errors.nomination_timer_sec)}
                      onChange={(event) => updateAuction("nomination_timer_sec", Number(event.target.value))}
                    />
                    <span>{RULES_COPY.secondsSuffix}</span>
                  </span>
                  <RuleError>{errors.nomination_timer_sec}</RuleError>
                </label>
                <label>
                  <span>Bid clock</span>
                  <span className="hub-rules-suffix-input">
                    <input
                      type="number"
                      min="5"
                      value={rules.auction.bid_timer_sec}
                      disabled={readOnlyRules}
                      aria-invalid={Boolean(errors.bid_timer_sec)}
                      onChange={(event) => updateAuction("bid_timer_sec", Number(event.target.value))}
                    />
                    <span>{RULES_COPY.secondsSuffix}</span>
                  </span>
                  <RuleError>{errors.bid_timer_sec}</RuleError>
                </label>
                <label>
                  <span>Late-bid extension</span>
                  <span className="hub-rules-suffix-input">
                    <input
                      type="number"
                      min="0"
                      value={rules.auction.bid_extension_sec}
                      disabled={readOnlyRules}
                      aria-invalid={Boolean(errors.bid_extension_sec)}
                      onChange={(event) => updateAuction("bid_extension_sec", Number(event.target.value))}
                    />
                    <span>{RULES_COPY.secondsSuffix}</span>
                  </span>
                  <RuleError>{errors.bid_extension_sec}</RuleError>
                </label>
              </div>
              <PolicyToggle checked={Boolean(rules.auction.allow_mid_draft_cuts)} disabled={readOnlyRules} title="Allow mid-draft cuts" description="Managers may release a drafted player while the auction is still running." onChange={(value) => updateAuction("allow_mid_draft_cuts", value)} />
            </section>
          )}

          {!readOnlyRules && (
            <div className="hub-rules-sticky-save">
              <button type="button" className="btn-primary" disabled={saveDisabled} onClick={save}>
                {saving ? RULES_COPY.saving : RULES_COPY.save}
              </button>
              {saveReason ? <p className="hub-rules-save-reason">{saveReason}</p> : null}
            </div>
          )}

          {presets.length > 0 && !readOnlyRules && (
            <details className="hub-rules-templates">
              <summary>{RULES_COPY.templatesTitle}</summary>
              <p id="rules-template-help">{RULES_COPY.templatesHelp}</p>
              <div>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={saving}
                    aria-describedby="rules-template-help"
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>

        <aside className="hub-rules-summary" aria-label="League rule summary">
          <div>
            <span className={`hub-rules-eyebrow${dirty ? " is-preview" : ""}`}>
              {glanceEyebrow(dirty)}
            </span>
            <h3>{name || "Your league"}</h3>
            <p>{season} season</p>
          </div>
          <dl>{summary.map((item) => <div key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
          <p className="hub-rules-summary-note">{RULES_COPY.staffOnly}</p>
          {saveControls}
          {undo && (
            <div className="hub-rules-undo" role="status">
              <p>{RULES_COPY.templateApplied(undo.label)}</p>
              <button type="button" className="btn-ghost btn-sm" onClick={undoTemplate}>
                {RULES_COPY.templateUndo}
              </button>
            </div>
          )}
          {status.text && (
            <p className={`hub-rules-status is-${status.kind || "ok"}`} role="status" aria-live="polite">
              {status.text}
            </p>
          )}
        </aside>
      </div>
    </HubPage>
  );
}
