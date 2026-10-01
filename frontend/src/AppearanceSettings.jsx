import React, { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { useAppearance } from "./AppearanceProvider";
import { APPEARANCE_COPY } from "./themePresentation";
import { ATMOSPHERE_INTENSITIES, ATMOSPHERE_OPTION_COPY } from "./DraftHub/atmosphereCatalog";
import CompanionScene from "./DraftHub/CompanionScene";
import { usePrefersReducedMotion } from "./DraftHub/AtmosphereLayer";

const subscribe = (listener) => window.scoreSenseTheme.subscribe(listener);
const preference = () => window.scoreSenseTheme.getPreference();

export default function AppearanceSettings() {
  const { prefs, save, loading, saving, message, error, loadError, retry } = useAppearance();
  const mode = useSyncExternalStore(subscribe, preference, () => "dark");
  const { hash } = useLocation();
  const busy = loading || saving || Boolean(loadError);
  const reduced = usePrefersReducedMotion();
  const effective = (key) => prefs.enabled && prefs[key] && (key === "companions" || prefs.motion);
  const setLayer = (key, checked) => save({
    atmosphere_enabled: true, atmosphere_motion: true,
    atmosphere_falling: effective("falling"), atmosphere_companions: effective("companions"), atmosphere_reactions: effective("reactions"),
    [`atmosphere_${key}`]: checked,
  });
  useEffect(() => { if (hash === "#appearance") document.getElementById("appearance")?.scrollIntoView(); }, [hash]);
  return <section id="appearance" className="account-settings-section appearance-settings" aria-labelledby="appearance-title">
    <h3 id="appearance-title" className="hub-panel-subtitle">{APPEARANCE_COPY.title}</h3>
    <p className="chart-note">{APPEARANCE_COPY.support}</p>
    <fieldset className="appearance-fieldset">
      <legend>{APPEARANCE_COPY.mode}</legend>
      <div className="appearance-mode-options">
        {APPEARANCE_COPY.modes.map((choice) => <label key={choice.id}>
          <input type="radio" name="appearance-mode" value={choice.id} checked={mode === choice.id} onChange={() => window.scoreSenseTheme.set(choice.id)} />
          <span>{choice.title}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset className="appearance-fieldset">
      <legend>{APPEARANCE_COPY.theme}</legend>
      <div className="appearance-theme-options">
        {APPEARANCE_COPY.themes.map((theme) => <label key={theme.id} className="appearance-theme-choice">
          <input type="radio" name="appearance-theme" value={theme.id} checked={prefs.atmosphere === theme.id} disabled={busy} onChange={() => save({ atmosphere: theme.id })} />
          <span className="appearance-theme-card">
            <span className={`appearance-theme-swatch appearance-theme-swatch--${theme.id}`} aria-hidden="true" />
            <strong>{theme.title}</strong><small>{theme.support}</small>
          </span>
        </label>)}
      </div>
    </fieldset>
    {prefs.atmosphere !== "none" && <>
      <section className="appearance-scene-preview" aria-label={APPEARANCE_COPY.preview}>
        <strong>{APPEARANCE_COPY.scenes[prefs.atmosphere].title}</strong>
        {effective("companions") && <CompanionScene theme={prefs.atmosphere} reactions={effective("reactions") && !reduced && !busy} />}
        <p className="chart-note">{!effective("companions") ? APPEARANCE_COPY.companionsOff : reduced ? APPEARANCE_COPY.reducedSupport : effective("reactions") ? APPEARANCE_COPY.scenes[prefs.atmosphere].hint : APPEARANCE_COPY.reactionsOff}</p>
      </section>
      <div className="appearance-effect-options">
        {["falling", "companions", "reactions"].map((key) => <label key={key} className="account-atmosphere-toggle">
          <input type="checkbox" checked={effective(key)} disabled={busy} onChange={(event) => setLayer(key, event.target.checked)} />
          <span><strong>{APPEARANCE_COPY[key]}</strong><small>{APPEARANCE_COPY[key + "Support"]}</small></span>
        </label>)}
      </div>
      <details className="appearance-details">
        <summary>{APPEARANCE_COPY.detail}</summary>
        <div className="account-atmosphere-options">
          {["pile", "wash"].map((key) => <label key={key} className="account-atmosphere-toggle">
            <input type="checkbox" checked={prefs[key]} disabled={busy} onChange={(event) => save({ [`atmosphere_${key}`]: event.target.checked })} />
            <span><strong>{ATMOSPHERE_OPTION_COPY[key].title}</strong><small>{ATMOSPHERE_OPTION_COPY[key].support}</small></span>
          </label>)}
          <fieldset className="appearance-fieldset">
            <legend>{ATMOSPHERE_OPTION_COPY.intensityTitle}</legend>
            <div className="appearance-mode-options">
              {ATMOSPHERE_INTENSITIES.map((level) => <label key={level}>
                <input type="radio" name="atmosphere-intensity" checked={prefs.intensity === level} disabled={busy} onChange={() => save({ atmosphere_intensity: level })} />
                <span>{ATMOSPHERE_OPTION_COPY.intensity[level].title}</span>
              </label>)}
            </div>
          </fieldset>
        </div>
      </details>
      <p className="chart-note">{APPEARANCE_COPY.still}</p>
    </>}
    <p className="appearance-save-status chart-note" role="status">{loading ? APPEARANCE_COPY.loading : saving ? APPEARANCE_COPY.saving : message}</p>
    {loadError && <div className="error" role="alert">{loadError}<button type="button" className="btn-ghost" onClick={retry}>{APPEARANCE_COPY.retry}</button></div>}
    {error && <div className="error" role="alert">{error}</div>}
  </section>;
}
