import React, { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { useAppearance } from "./AppearanceProvider";
import { APPEARANCE_COPY } from "./themePresentation";
import { ATMOSPHERE_INTENSITIES, ATMOSPHERE_OPTION_COPY } from "./DraftHub/atmosphereCatalog";

const subscribe = (listener) => window.scoreSenseTheme.subscribe(listener);
const preference = () => window.scoreSenseTheme.getPreference();

export default function AppearanceSettings() {
  const { prefs, save, loading, saving, message, error, loadError, retry } = useAppearance();
  const mode = useSyncExternalStore(subscribe, preference, () => "dark");
  const { hash } = useLocation();
  const busy = loading || saving || Boolean(loadError);
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
      <div className="appearance-effect-options">
        {[{ key: "enabled", title: APPEARANCE_COPY.atmosphere, support: APPEARANCE_COPY.atmosphereSupport }, { key: "motion", title: APPEARANCE_COPY.motion, support: APPEARANCE_COPY.motionSupport }].map((option) => <label key={option.key} className="account-atmosphere-toggle">
          <input type="checkbox" checked={prefs[option.key]} disabled={busy} onChange={(event) => save({ [`atmosphere_${option.key}`]: event.target.checked })} />
          <span><strong>{option.title}</strong><small>{option.support}</small></span>
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
