import React, { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { useAppearance } from "./AppearanceProvider";
import { APPEARANCE_COPY } from "./themePresentation";
import { ATMOSPHERE_INTENSITIES, ATMOSPHERE_OPTION_COPY } from "./DraftHub/atmosphereCatalog";
import CompanionScene from "./DraftHub/CompanionScene";
import { usePrefersReducedMotion } from "./DraftHub/AtmosphereLayer";

const subscribe = (listener) => window.scoreSenseTheme.subscribe(listener);
const preference = () => window.scoreSenseTheme.getPreference();
const snapshot = () => window.scoreSenseTheme.getSnapshot();

export default function AppearanceSettings() {
  const { prefs, save, loading, saving, message, error, loadError, retry } = useAppearance();
  const mode = useSyncExternalStore(subscribe, preference, () => "dark");
  const resolvedMode = useSyncExternalStore(subscribe, snapshot, () => "dark");
  const { hash } = useLocation();
  const busy = loading || saving || Boolean(loadError);
  const reduced = usePrefersReducedMotion();
  const effective = (key) => prefs.enabled && prefs[key] && (key === "companions" || prefs.motion);
  const setLayer = (key, checked) => save({
    atmosphere_enabled: true,
    atmosphere_motion: true,
    atmosphere_falling: effective("falling"),
    atmosphere_companions: effective("companions"),
    atmosphere_reactions: effective("reactions"),
    [`atmosphere_${key}`]: checked,
  });
  useEffect(() => {
    if (hash === "#appearance") document.getElementById("appearance")?.scrollIntoView();
  }, [hash]);

  const activeThemeMeta = APPEARANCE_COPY.themes.find((t) => t.id === prefs.atmosphere) || APPEARANCE_COPY.themes[0];
  const sceneMeta = APPEARANCE_COPY.scenes[prefs.atmosphere];

  return (
    <section id="appearance" className="account-settings-section appearance-settings" aria-labelledby="appearance-title">
      <div className="appearance-head">
        <div>
          <h3 id="appearance-title" className="hub-panel-subtitle">{APPEARANCE_COPY.title}</h3>
          <p className="chart-note">{APPEARANCE_COPY.support}</p>
        </div>
        <span className="appearance-contrast-badge">{APPEARANCE_COPY.contrastBadge}</span>
      </div>

      <div className="appearance-workbench">
        <div className="appearance-workbench-controls">
          <fieldset className="appearance-fieldset">
            <legend>{APPEARANCE_COPY.mode}</legend>
            <div className="appearance-mode-options">
              {APPEARANCE_COPY.modes.map((choice) => (
                <label key={choice.id}>
                  <input
                    type="radio"
                    name="appearance-mode"
                    value={choice.id}
                    checked={mode === choice.id}
                    onChange={() => window.scoreSenseTheme.set(choice.id)}
                  />
                  <span>{choice.title}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="appearance-fieldset">
            <legend>{APPEARANCE_COPY.theme}</legend>
            <div className="appearance-theme-options">
              {APPEARANCE_COPY.themes.map((theme) => (
                <label key={theme.id} className="appearance-theme-choice">
                  <input
                    type="radio"
                    name="appearance-theme"
                    value={theme.id}
                    checked={prefs.atmosphere === theme.id}
                    disabled={busy}
                    onChange={() => save({ atmosphere: theme.id })}
                  />
                  <span className="appearance-theme-card">
                    <span className={`appearance-theme-swatch appearance-theme-swatch--${theme.id}`} aria-hidden="true" />
                    <span className="appearance-theme-card-head">
                      <strong>{theme.title}</strong>
                      {theme.badge && <em className="appearance-theme-badge">{theme.badge}</em>}
                    </span>
                    <small>{theme.support}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {prefs.atmosphere !== "none" && (
            <>
              <div className="appearance-effect-options">
                {["falling", "companions", "reactions"].map((key) => (
                  <label
                    key={key}
                    className={`account-atmosphere-toggle${key === "reactions" ? " account-atmosphere-toggle--nested" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={effective(key)}
                      disabled={busy}
                      onChange={(event) => setLayer(key, event.target.checked)}
                    />
                    <span>
                      <strong>{APPEARANCE_COPY[key]}</strong>
                      <small>{APPEARANCE_COPY[key + "Support"]}</small>
                    </span>
                  </label>
                ))}
              </div>

              <details className="appearance-details">
                <summary>{APPEARANCE_COPY.detail}</summary>
                <div className="account-atmosphere-options">
                  {["pile", "wash"].map((key) => (
                    <label key={key} className="account-atmosphere-toggle">
                      <input
                        type="checkbox"
                        checked={prefs[key]}
                        disabled={busy}
                        onChange={(event) => save({ [`atmosphere_${key}`]: event.target.checked })}
                      />
                      <span>
                        <strong>{ATMOSPHERE_OPTION_COPY[key].title}</strong>
                        <small>{ATMOSPHERE_OPTION_COPY[key].support}</small>
                      </span>
                    </label>
                  ))}
                  <fieldset className="appearance-fieldset">
                    <legend>{ATMOSPHERE_OPTION_COPY.intensityTitle}</legend>
                    <div className="appearance-mode-options">
                      {ATMOSPHERE_INTENSITIES.map((level) => (
                        <label key={level}>
                          <input
                            type="radio"
                            name="atmosphere-intensity"
                            checked={prefs.intensity === level}
                            disabled={busy}
                            onChange={() => save({ atmosphere_intensity: level })}
                          />
                          <span>{ATMOSPHERE_OPTION_COPY.intensity[level].title}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </details>
              <p className="chart-note">{APPEARANCE_COPY.still}</p>
            </>
          )}
        </div>

        <aside className="appearance-workbench-stage">
          <section className="appearance-scene-preview" aria-label={APPEARANCE_COPY.preview}>
            <div className="appearance-scene-caption">
              <strong>{sceneMeta ? sceneMeta.title : activeThemeMeta.title}</strong>
              <span>{activeThemeMeta.title} · {resolvedMode === "light" ? "Light" : "Dark"}</span>
            </div>

            <div className="appearance-sample-card" aria-hidden="true">
              <div className="appearance-sample-hero">
                <span className="appearance-sample-kicker">{APPEARANCE_COPY.sampleKicker}</span>
                <span className="appearance-sample-chip">{activeThemeMeta.title}</span>
              </div>
              <div className="appearance-sample-row">
                <div className="appearance-sample-player">
                  <span className="appearance-sample-tier">S</span>
                  <div className="appearance-sample-meta">
                    <strong>{APPEARANCE_COPY.samplePlayer}</strong>
                    <small>{APPEARANCE_COPY.sampleStat}</small>
                  </div>
                </div>
                <div className="appearance-sample-actions">
                  <span className="appearance-sample-delta">{APPEARANCE_COPY.sampleDelta}</span>
                  <span className="appearance-sample-cta">{APPEARANCE_COPY.sampleAction}</span>
                </div>
              </div>
            </div>

            {prefs.atmosphere !== "none" && effective("companions") && (
              <CompanionScene
                theme={prefs.atmosphere}
                reactions={effective("reactions") && !reduced && !busy}
              />
            )}

            <p className="chart-note">
              {prefs.atmosphere === "none"
                ? APPEARANCE_COPY.classicPreview
                : !effective("companions")
                  ? APPEARANCE_COPY.companionsOff
                  : reduced
                    ? APPEARANCE_COPY.reducedSupport
                    : effective("reactions")
                      ? sceneMeta.hint
                      : APPEARANCE_COPY.reactionsOff}
            </p>
          </section>
        </aside>
      </div>

      <p className="appearance-save-status chart-note" role="status">
        {loading ? APPEARANCE_COPY.loading : saving ? APPEARANCE_COPY.saving : message}
      </p>
      {loadError && (
        <div className="error" role="alert">
          {loadError}
          <button type="button" className="btn-ghost" onClick={retry}>{APPEARANCE_COPY.retry}</button>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}
