import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../auth";
import { parseApiError } from "../../format";
import { HubExperienceHero, HubPage } from "../HubUILayout";
import { InsightsDisclosure, RankBars } from "./InsightsTalk";
import { INSIGHTS_COPY, insightsHeroStatus, teamDisplayName } from "./insightsPresentation";

function formatRecord(row) {
  const wins = Number(row.wins) || 0;
  const losses = Number(row.losses) || 0;
  const ties = Number(row.ties) || 0;
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function formatWinPct(row) {
  const pct = Number(row.win_pct);
  if (!Number.isFinite(pct) || (Number(row.games) || 0) <= 0) return "—";
  return `${(pct * 100).toFixed(1)}%`;
}

function formatPoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export default function InsightsOverview({
  landing,
  ownerMap,
  loading,
  onOpenTab,
  isCommissioner,
  awardCatalog,
  currentRules,
  onRulesSaved,
}) {
  const champions = landing?.champions || [];
  const records = landing?.record_leaders || [];
  const scorers = landing?.scoring_leaders || [];
  const hasLanding = Boolean(landing?.available);
  const recordRows = useMemo(
    () => records.filter((row) => (Number(row.games) || 0) > 0).slice(0, 8).map((row, idx) => {
      const label = teamDisplayName(row, ownerMap, false);
      const leader = Number(records[0]?.win_pct) || 0;
      return {
        ...row,
        rank: idx + 1,
        label,
        pctOfLeader: leader > 0 ? (Number(row.win_pct) / leader) * 100 : 0,
      };
    }),
    [records, ownerMap],
  );
  const scoringRows = useMemo(
    () => scorers.slice(0, 8).map((row, idx) => {
      const label = teamDisplayName(row, ownerMap, false);
      const leader = Number(scorers[0]?.total_points) || 0;
      const total = Number(row.total_points) || 0;
      return {
        ...row,
        rank: idx + 1,
        label,
        pctOfLeader: leader > 0 ? (total / leader) * 100 : 0,
      };
    }),
    [scorers, ownerMap],
  );

  return (
    <HubPage className="hub-spend-page hub-experience-page hub-insights-page">
      <HubExperienceHero
        eyebrow={INSIGHTS_COPY.overview.eyebrow}
        heading={INSIGHTS_COPY.overview.heading}
        support={INSIGHTS_COPY.overview.support}
        chip={landing?.seasons_included?.length ? `${landing.seasons_included.length} seasons` : "League history"}
      >
        {landing?.most_titles?.titles > 1 ? (
          <p className="hub-experience-hero-status">
            {insightsHeroStatus([{
              title: "Titles",
              owner_name: landing.most_titles.owner_name
                || ownerMap?.[landing.most_titles.team_name]
                || ownerMap?.[String(landing.most_titles.team_name || "").toLowerCase()],
              team_name: landing.most_titles.team_name,
              title_count: landing.most_titles.titles,
            }])}
          </p>
        ) : null}
      </HubExperienceHero>

      {loading && !hasLanding && (
        <p className="chart-note">Loading league history…</p>
      )}

      {!loading && !hasLanding && (
        <p className="chart-note">
          {landing?.hint || "Link a Sleeper league to see champions, records, and scoring leaders."}
        </p>
      )}

      {hasLanding && (
        <div className="hub-insights-overview-grid">
          <section className="hub-insights-overview-panel" aria-label="League winners">
            <div className="hub-insights-talk-head">
              <h3>Winners by year</h3>
              <p>
                {champions.length
                  ? "Championships from the Sleeper bracket."
                  : "Champions appear once a season’s bracket is complete."}
              </p>
            </div>
            {champions.length ? (
              <ol className="hub-insights-champions">
                {champions.map((row) => (
                  <li key={row.season}>
                    <span className="hub-insights-champions-year">{row.season}</span>
                    <strong>{teamDisplayName(row, ownerMap, true)}</strong>
                    {row.runner_up ? (
                      <span className="chart-note">def. {row.runner_up}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="chart-note">No completed championships in the Sleeper history yet.</p>
            )}
          </section>

          <section className="hub-insights-overview-panel" aria-label="All-time records">
            <div className="hub-insights-talk-head">
              <h3>All-time records</h3>
              <p>
                {landing?.has_records
                  ? "Regular-season wins across every scored year."
                  : "Win-loss records fill in after scoring history refreshes."}
              </p>
            </div>
            {recordRows.length ? (
              <RankBars
                rows={recordRows}
                color="#8b9bb0"
                formatValue={(row) => `${formatRecord(row)} · ${formatWinPct(row)}`}
              />
            ) : (
              <p className="chart-note">No win-loss records yet. Open Scoring and refresh if this stays empty.</p>
            )}
            <button type="button" className="btn-link btn-sm" onClick={() => onOpenTab("scoring")}>
              Open scoring
            </button>
          </section>

          <section className="hub-insights-overview-panel" aria-label="All-time scoring">
            <div className="hub-insights-talk-head">
              <h3>All-time scoring</h3>
              <p>Total fantasy points across scored seasons.</p>
            </div>
            {scoringRows.length ? (
              <RankBars
                rows={scoringRows}
                color="#22c55e"
                formatValue={(row) => `${formatPoints(row.total_points)} pts`}
              />
            ) : (
              <p className="chart-note">No scoring history yet.</p>
            )}
          </section>
        </div>
      )}

      {isCommissioner && (
        <AwardTitlesEditor
          catalog={awardCatalog || landing?.award_catalog || []}
          currentRules={currentRules}
          onSaved={onRulesSaved}
        />
      )}
    </HubPage>
  );
}

function AwardTitlesEditor({ catalog, currentRules, onSaved }) {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setDraft(Object.fromEntries(
      (catalog || []).map((row) => [row.id, row.title || row.default_title || ""]),
    ));
  }, [catalog]);

  const spend = (catalog || []).filter((row) => row.group === "spend");
  const scoring = (catalog || []).filter((row) => row.group === "scoring");

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const insight_award_titles = {};
      (catalog || []).forEach((row) => {
        const next = String(draft[row.id] || "").trim();
        if (next && next !== row.default_title) insight_award_titles[row.id] = next;
      });
      const res = await apiFetch("/api/hub/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: { ...(currentRules || {}), insight_award_titles },
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      onSaved?.(data);
      setStatus("Award names saved.");
    } catch (error) {
      setStatus(error.message || "Could not save award names.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <InsightsDisclosure
      summary="Award names"
      meta="Commissioner · rename the labels everyone sees"
    >
      <div className="hub-insights-award-editor">
        <p className="chart-note">
          Defaults are factual. Blank a field and save to restore the original name.
        </p>
        <div className="hub-insights-award-editor-grid">
          <fieldset>
            <legend>Spend</legend>
            {spend.map((row) => (
              <label key={row.id}>
                <span>{row.default_title}</span>
                <input
                  type="text"
                  maxLength={48}
                  value={draft[row.id] ?? ""}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [row.id]: event.target.value }))}
                />
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Scoring</legend>
            {scoring.map((row) => (
              <label key={row.id}>
                <span>{row.default_title}</span>
                <input
                  type="text"
                  maxLength={48}
                  value={draft[row.id] ?? ""}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [row.id]: event.target.value }))}
                />
              </label>
            ))}
          </fieldset>
        </div>
        <div className="hub-insights-award-editor-actions">
          <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save names"}
          </button>
          {status ? <span className="chart-note">{status}</span> : null}
        </div>
      </div>
    </InsightsDisclosure>
  );
}
