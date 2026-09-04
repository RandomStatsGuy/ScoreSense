import React, { useMemo } from "react";
import { ACCURACY_COPY } from "./accuracyPresentation";
import useMobileLayout from "./useMobileLayout";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = {
  scoresense: "#2563eb",
  site_composite: "#f59e0b",
  ffopportunity: "#94a3b8",
  model_blended: "#10b981",
  season_avg: "#64748b",
  last_game: "#a855f7",
  fantasypros: "#e11d48",
  espn: "#0ea5e9",
  boom_recall: "#22c55e",
  mae: "#2563eb",
};

const DEFAULT_FORECAST = ["scoresense", "site_composite", "model_blended", "season_avg", "last_game"];
const DEFAULT_DIAGNOSTIC = ["ffopportunity", "espn", "fantasypros"];

const BOOM_WEEK_COPY = {
  qb: "25+ PPR",
  rb: "20+ PPR",
  wr: "20+ PPR",
};

const PLAIN_SERIES_NAMES = {
  scoresense: "ScoreSense",
  site_composite: "Simple guess",
  season_avg: "Season average",
  last_game: "Last game",
  model_blended: "Blended forecast",
  ffopportunity: "Perfect-hindsight EP",
  espn: "ESPN weekly",
  fantasypros: "FantasyPros consensus",
};

function maeDomain(values) {
  const nums = (values || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (!nums.length) return [0, 8];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = Math.max(max - min, 0.2);
  const pad = Math.max(span * 0.2, 0.08);
  const lo = Math.floor((min - pad) * 20) / 20;
  const hi = Math.ceil((max + pad) * 20) / 20;
  return [lo, hi];
}

function formatMiss(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(1)} pts`;
}

function seriesLabel(key, reportLabels, blendAlpha) {
  if (key === "model_blended" && blendAlpha != null) {
    return `Blended (${Math.round(blendAlpha * 100)}% ScoreSense)`;
  }
  return PLAIN_SERIES_NAMES[key] || reportLabels?.[key] || key;
}

function DualAxisTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const miss = payload.find((p) => p.dataKey === "mae")?.value;
  const catchRate = payload.find((p) => p.dataKey === "boom_recall")?.value;
  return (
    <div className="chart-tooltip chart-tooltip-light">
      <span className="chart-tooltip-year">{label} season</span>
      {miss != null && (
        <div className="chart-tooltip-row chart-tooltip-mae">
          <span>Avg. miss</span>
          <strong>{formatMiss(miss)}</strong>
        </div>
      )}
      {catchRate != null && (
        <div className="chart-tooltip-row chart-tooltip-recall">
          <span>Big-game catch rate</span>
          <strong>{(Number(catchRate) * 100).toFixed(0)}%</strong>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, hint, primary = false }) {
  return (
    <div className={`summary-card${primary ? " summary-card-primary" : ""}`} title={hint || undefined}>
      <span className="summary-label">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="summary-hint">{hint}</span>}
    </div>
  );
}

function HeroStat({ label, value, sub, accent }) {
  return (
    <div className={`accuracy-hero-stat${accent ? " accuracy-hero-stat-accent" : ""}`}>
      <span className="accuracy-hero-stat-label">{label}</span>
      <strong className="accuracy-hero-stat-value">{value}</strong>
      {sub && <span className="accuracy-hero-stat-sub">{sub}</span>}
    </div>
  );
}

function downloadAccuracyBundle({ report, upsideReport, seasonLongReport, position }) {
  const payload = {
    exported_at: new Date().toISOString(),
    position,
    weekly_backtest: report,
    upside: upsideReport,
    season_long: seasonLongReport,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scoresense-accuracy-${position}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function TrustHero({ position, summary, upsideSummary, seasonRange }) {
  const beats = summary?.scoresense_beats_composite_seasons ?? 0;
  const total = summary?.total_seasons ?? 0;
  const miss = formatMiss(summary?.scoresense_avg_mae);
  const guessMiss = formatMiss(summary?.site_composite_avg_mae);
  const boomPct =
    upsideSummary?.avg_boom_recall != null
      ? `${(upsideSummary.avg_boom_recall * 100).toFixed(0)}%`
      : null;
  const posLabel = position === "qb" ? "quarterbacks" : position === "rb" ? "running backs" : "receivers";

  return (
    <div className="trust-hero panel">
      <div className="panel-head">
        <div>
          <h2>{ACCURACY_COPY.heading}</h2>
          <p className="panel-subtitle">{ACCURACY_COPY.support(seasonRange)}</p>
        </div>
      </div>

      <p className="trust-hero-lead">{ACCURACY_COPY.lead}</p>

      <ul className="trust-points">
        <li>
          <strong>{ACCURACY_COPY.moreAccurate}</strong>{" "}
          {ACCURACY_COPY.moreAccurateBody(posLabel, miss, guessMiss, beats, total)}
        </li>
        {boomPct && (
          <li>
            <strong>{ACCURACY_COPY.boomTitle}</strong> {ACCURACY_COPY.boomBody(boomPct)}
          </li>
        )}
        <li>
          <strong>{ACCURACY_COPY.noPeek}</strong> {ACCURACY_COPY.noPeekBody}
        </li>
      </ul>

      <div className="accuracy-hero-grid trust-stats">
        <HeroStat label={ACCURACY_COPY.missLabel} value={miss} sub={ACCURACY_COPY.missSub} accent />
        <HeroStat label={ACCURACY_COPY.beatLabel} value={`${beats} / ${total}`} sub={ACCURACY_COPY.beatSub} />
        {boomPct && (
          <HeroStat label={ACCURACY_COPY.boomLabel} value={boomPct} sub={ACCURACY_COPY.boomSub} />
        )}
      </div>

      {total > 0 && beats === total && (
        <p className="accuracy-verdict-inline" role="status">
          {ACCURACY_COPY.allSeasons(total)}
        </p>
      )}
    </div>
  );
}

function AccuracyHero({ position, summary, upsideSummary, seasonRange, report }) {
  const boomCopy = BOOM_WEEK_COPY[position] || BOOM_WEEK_COPY.wr;
  const beats = summary?.scoresense_beats_composite_seasons ?? 0;
  const total = summary?.total_seasons ?? 0;
  const allSeasonsWin = total > 0 && beats === total;
  const espnWeekly = report?.espn_is_weekly_benchmark;
  const fpBenchmark = report?.fantasypros_is_benchmark;

  return (
    <div className="accuracy-hero panel">
      <div className="panel-head">
        <div>
          <h2>{ACCURACY_COPY.resultsHeading}</h2>
          <p className="panel-subtitle">{ACCURACY_COPY.resultsSupport(seasonRange)}</p>
        </div>
      </div>

      <div className="accuracy-hero-grid">
        <HeroStat
          label="ScoreSense avg. miss"
          value={formatMiss(summary?.scoresense_avg_mae)}
          sub="Lower is better"
          accent
        />
        <HeroStat
          label="Simple guess"
          value={formatMiss(summary?.site_composite_avg_mae)}
          sub="Season avg + last game"
        />
        <HeroStat
          label="vs simple guess"
          value={`${beats}/${total}`}
          sub="Seasons closer to actual"
        />
        {upsideSummary?.avg_boom_recall != null && (
          <HeroStat
            label="Big-game catch rate"
            value={`${(upsideSummary.avg_boom_recall * 100).toFixed(0)}%`}
            sub={`Spike weeks (${boomCopy}) flagged`}
          />
        )}
      </div>

      {allSeasonsWin && (
        <p className="accuracy-verdict-inline" role="status">
          Beat the simple baseline in all {total} tested seasons.
        </p>
      )}

      <details className="accuracy-glossary">
        <summary className="accuracy-glossary-summary">How to read this page</summary>
        <dl className="accuracy-glossary-list">
          <div>
            <dt>Avg. miss</dt>
            <dd>
              Typical distance from actual weekly fantasy points. Project 18, score 22 → 4 pt miss.
            </dd>
          </div>
          <div>
            <dt>Simple guess</dt>
            <dd>
              Non-ML baseline: average of season scoring pace and last week&apos;s points — what a
              fan might guess Sunday morning.
            </dd>
          </div>
          <div>
            <dt>Big-game catch rate</dt>
            <dd>
              When a player hits a spike week ({boomCopy}), did we flag them with a high ceiling
              beforehand?
              {upsideSummary?.avg_boom_p90_coverage != null && (
                <>
                  {" "}
                  Ceiling band covers{" "}
                  {(upsideSummary.avg_boom_p90_coverage * 100).toFixed(0)}% of those breakouts.
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>ESPN</dt>
            <dd>
              {espnWeekly
                ? "Open weekly benchmark when the API returns true pre-game values."
                : "Public API values behave like season totals, not weekly lines — see reference benchmarks below."}
            </dd>
          </div>
          <div>
            <dt>FantasyPros</dt>
            <dd>
              {fpBenchmark ? (
                <>
                  Consensus PPR weekly benchmark ({((report?.fantasypros_coverage_rate ?? 0) * 100).toFixed(0)}%
                  coverage), shown for comparison only — not an input to our model.
                </>
              ) : (
                <>The FantasyPros comparison line isn&apos;t available right now.</>
              )}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}

function formatSpearman(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(3);
}

function SeasonLongAccuracySection({ report }) {
  if (!report || !Array.isArray(report.seasons) || report.seasons.length === 0) {
    return (
      <details className="metric-group accuracy-collapsible">
        <summary className="metric-group-summary">Season-long accuracy</summary>
        <p className="metric-group-desc metric-group-desc-tight">
          Draft-style preseason totals and mid-season rest-of-season projections.
          These aren&apos;t available yet — check back after the next model refresh.
        </p>
      </details>
    );
  }

  const summary = report.summary || {};
  const preseason = summary.preseason || {};
  const rosSummary = summary.ros || {};
  const checkpointWeeks = report.ros_checkpoint_weeks || Object.keys(rosSummary);
  const seasonRange =
    report.seasons.length > 1
      ? `${report.seasons[0]}–${report.seasons[report.seasons.length - 1]}`
      : String(report.seasons[0]);

  const fpBenchmark = report.fantasypros_is_benchmark !== false;
  const fpLabel = report.fantasypros_label || "FantasyPros Week 1 × 17";

  const preseasonChartData = report.seasons.map((season, idx) => ({
    season: String(season),
    scoresense: report.preseason_series?.scoresense_mae?.[idx],
    baseline: report.preseason_series?.baseline_mae?.[idx],
    fantasypros: report.preseason_series?.fantasypros_mae?.[idx],
  }));

  const rosChartData = checkpointWeeks.map((week) => {
    const row = { checkpoint: `Week ${week}` };
    const metrics = rosSummary[String(week)] || {};
    row.scoresense = metrics.avg_mae;
    row.baseline = metrics.avg_baseline_mae;
    return row;
  });

  const preseasonMaeDomain = maeDomain([
    ...(report.preseason_series?.scoresense_mae || []),
    ...(report.preseason_series?.baseline_mae || []),
    ...(report.preseason_series?.fantasypros_mae || []),
  ]);

  const rosMaeDomain = maeDomain([
    ...checkpointWeeks.flatMap((w) => {
      const m = rosSummary[String(w)] || {};
      return [m.avg_mae, m.avg_baseline_mae];
    }),
  ]);

  return (
    <details className="metric-group accuracy-collapsible" open>
      <summary className="metric-group-summary">Season-long accuracy</summary>
      <p className="metric-group-desc metric-group-desc-tight">
        Preseason Week 1 median × 17 vs final totals (QB blends prior-year PPG); FantasyPros week-1
        consensus × 17 as industry proxy when archive coverage is sufficient; ROS uses YTD + rolling P50
        × games remaining (17 − played).
      </p>

      <div className="summary-grid">
        <SummaryCard
          label="Preseason avg. miss"
          value={formatMiss(preseason.avg_mae)}
          hint="Week 1 projection × 17 vs final season total"
        />
        <SummaryCard
          label="Preseason rank correlation"
          value={formatSpearman(preseason.avg_spearman)}
          hint="Spearman on season totals"
        />
        <SummaryCard
          label="Baseline preseason miss"
          value={formatMiss(preseason.avg_baseline_mae)}
          hint={report.baseline_label || "Prior-year PPG × 17"}
        />
        <SummaryCard
          label="Preseason vs baseline"
          value={`${preseason.beats_baseline_seasons ?? 0}/${preseason.total_seasons ?? 0} seasons`}
          hint="Seasons ScoreSense beat baseline"
        />
        {summary.preseason_draft_cohort?.avg_mae != null && (
          <SummaryCard
            label="Draft cohort preseason miss"
            value={formatMiss(summary.preseason_draft_cohort.avg_mae)}
            hint="Depth-filtered board vs full eval cohort"
          />
        )}
        {preseason.avg_fantasypros_mae != null && (
          <SummaryCard
            label="FantasyPros preseason miss"
            value={formatMiss(preseason.avg_fantasypros_mae)}
            hint={fpLabel}
          />
        )}
        {preseason.total_fp_benchmark_seasons > 0 && (
          <SummaryCard
            label="Preseason vs FantasyPros"
            value={`${preseason.beats_fantasypros_seasons ?? 0}/${preseason.total_fp_benchmark_seasons} seasons`}
            hint={
              fpBenchmark
                ? "Seasons ScoreSense beat FP proxy (≥30% coverage)"
                : "FP benchmark diagnostic — low archive coverage"
            }
          />
        )}
        {!fpBenchmark && preseason.avg_fantasypros_coverage != null && (
          <SummaryCard
            label="FP archive coverage"
            value={`${((preseason.avg_fantasypros_coverage ?? 0) * 100).toFixed(0)}%`}
            hint="Below 30% — FP line is diagnostic only"
          />
        )}
      </div>

      {checkpointWeeks.map((week) => {
        const m = rosSummary[String(week)] || {};
        return (
          <div key={week} className="summary-grid summary-grid-inline">
            <SummaryCard
              label={`ROS from week ${week}`}
              value={formatMiss(m.avg_mae)}
              hint="YTD + rolling P50 × games left"
            />
            <SummaryCard
              label={`ROS week ${week} rank ρ`}
              value={formatSpearman(m.avg_spearman)}
              hint="Projected vs actual totals"
            />
            <SummaryCard
              label={`ROS week ${week} baseline`}
              value={formatMiss(m.avg_baseline_mae)}
              hint="Prior-year PPG × 17"
            />
          </div>
        );
      })}

      <div className="panel panel-inset">
        <h2 className="chart-heading">Preseason total by season ({seasonRange})</h2>
        <div className="chart-wrap chart-wrap-compact">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={preseasonChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="season" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" domain={preseasonMaeDomain} />
              <Tooltip
                contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a" }}
                formatter={(value) => formatMiss(value)}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="scoresense"
                name="ScoreSense"
                stroke={COLORS.scoresense}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="baseline"
                name="Prior-year PPG × 17"
                stroke={COLORS.season_avg}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="fantasypros"
                name={fpBenchmark ? "FantasyPros W1 × 17" : "FantasyPros (diagnostic)"}
                stroke={COLORS.fantasypros}
                strokeWidth={2}
                strokeDasharray={fpBenchmark ? undefined : "4 4"}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel panel-inset">
        <h2 className="chart-heading">ROS checkpoints — avg. miss</h2>
        <div className="chart-wrap chart-wrap-compact">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rosChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="checkpoint" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" domain={rosMaeDomain} />
              <Tooltip
                contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a" }}
                formatter={(value) => formatMiss(value)}
              />
              <Legend />
              <Bar dataKey="scoresense" name="ScoreSense" fill={COLORS.scoresense} />
              <Bar dataKey="baseline" name="Prior-year PPG × 17" fill={COLORS.season_avg} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {report.notes && <p className="chart-note methodology-note">{report.notes}</p>}
    </details>
  );
}

export default function AccuracyChart({
  report,
  upsideReport,
  seasonLongReport,
  loading,
  error,
  onRebuild,
  rebuildLoading = false,
}) {
  const mobileLayout = useMobileLayout();
  const upsideChartData = useMemo(
    () =>
      (upsideReport?.seasons || []).map((season, idx) => ({
        season: String(season),
        mae: upsideReport.series?.mae?.[idx],
        boom_recall: upsideReport.series?.boom_recall?.[idx],
      })),
    [upsideReport]
  );

  const upsideMaeDomain = useMemo(
    () => maeDomain(upsideReport?.series?.mae),
    [upsideReport]
  );

  if (loading) return <div className="panel muted">Loading accuracy report…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!report || !Array.isArray(report.seasons) || report.seasons.length === 0) {
    return (
      <div className="accuracy-section">
        <div className="panel muted">
          Accuracy backtests aren&apos;t available yet.
          {onRebuild ? " An admin can rebuild them below." : " Check back soon."}
        </div>
        {onRebuild && (
          <details className="accuracy-admin">
            <summary className="accuracy-admin-summary">Report maintenance (admin)</summary>
            <button
              type="button"
              className="btn-ghost btn-sm accuracy-admin-btn"
              onClick={onRebuild}
              disabled={rebuildLoading}
            >
              {rebuildLoading ? "Working…" : "Rebuild accuracy report"}
            </button>
          </details>
        )}
      </div>
    );
  }

  const chartData = report.seasons.map((season, idx) => {
    const row = { season: String(season) };
    for (const [key, values] of Object.entries(report.series || {})) {
      if (values[idx] != null) row[key] = values[idx];
    }
    return row;
  });

  const reportLabels = report.labels || {};
  const forecastKeys = report.forecast_keys || DEFAULT_FORECAST;
  const diagnosticKeys = report.diagnostic_keys || DEFAULT_DIAGNOSTIC;
  const activeForecast = forecastKeys.filter((k) =>
    (report.series?.[k] || []).some((v) => v != null)
  );
  const activeDiagnostic = diagnosticKeys.filter((k) =>
    (report.series?.[k] || []).some((v) => v != null)
  );

  const summary = report.summary || {};
  const upsideSummary = upsideReport?.summary;
  const position = report.position || "qb";
  const seasonRange =
    report.seasons?.length > 1
      ? `${report.seasons[0]}–${report.seasons[report.seasons.length - 1]}`
      : String(report.seasons?.[0] ?? "");

  const chartName = (key) => seriesLabel(key, reportLabels, report.blend_alpha);

  const simpleChartData = report.seasons.map((season, idx) => ({
    season: String(season),
    scoresense: report.series?.scoresense?.[idx],
    site_composite: report.series?.site_composite?.[idx],
  }));

  const hasExtendedStats =
    summary.season_avg_mae != null ||
    (summary.fantasypros_avg_mae != null && report.fantasypros_is_benchmark);

  return (
    <div className="accuracy-section">
      {mobileLayout ? (
        <nav className="accuracy-mobile-nav" aria-label="Report sections">
          <a href="#accuracy-trust">Trust</a>
          <a href="#accuracy-weekly">Weekly</a>
          <a href="#accuracy-season">Season</a>
          <a href="#accuracy-technical">Technical</a>
        </nav>
      ) : null}
      <div id="accuracy-trust">
      <TrustHero
        position={position}
        summary={summary}
        upsideSummary={upsideSummary}
        seasonRange={seasonRange}
      />
      </div>

      <div className="panel" id="accuracy-weekly">
        <h2 className="chart-heading">How close were we each season?</h2>
        <p className="chart-caption chart-caption-tight">
          Average distance from actual weekly fantasy points. Lower lines are better. The orange line is a
          non-ML guess (season pace + last game).
        </p>
        <div className="chart-wrap chart-wrap-compact">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={simpleChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="season" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a" }}
                formatter={(value) => formatMiss(value)}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="scoresense"
                name="ScoreSense"
                stroke={COLORS.scoresense}
                strokeWidth={3}
                dot={{ r: 4 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="site_composite"
                name="Simple guess"
                stroke={COLORS.site_composite}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="accuracy-export-bar">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() =>
            downloadAccuracyBundle({ report, upsideReport, seasonLongReport, position })
          }
        >
          Download full accuracy report (JSON)
        </button>
        <span className="table-meta">Includes weekly backtest, breakout stats, and season-long eval</span>
      </div>

      <details className="panel accuracy-technical" id="accuracy-technical">
        <summary className="accuracy-technical-summary">Detailed charts &amp; methodology</summary>
        <div className="accuracy-technical-body">
      <AccuracyHero
        position={position}
        summary={summary}
        upsideSummary={upsideSummary}
        seasonRange={seasonRange}
        report={report}
      />

      {hasExtendedStats && (
        <div className="metric-group metric-group-compact">
          <h3 className="metric-group-title metric-group-title-plain">Other benchmarks</h3>
          <div className="summary-grid">
            {summary.season_avg_mae != null && (
              <SummaryCard
                label="Season average alone"
                value={formatMiss(summary.season_avg_mae)}
                hint="Season points ÷ games"
              />
            )}
            {summary.fantasypros_avg_mae != null && report.fantasypros_is_benchmark && (
              <SummaryCard
                label="FantasyPros avg. miss"
                value={formatMiss(summary.fantasypros_avg_mae)}
                hint="Consensus PPR weekly"
              />
            )}
            {summary.scoresense_beats_fantasypros_seasons != null &&
              report.fantasypros_is_benchmark && (
                <SummaryCard
                  label="ScoreSense vs FantasyPros"
                  value={`${summary.scoresense_beats_fantasypros_seasons}/${summary.total_seasons} seasons`}
                  hint="Seasons ScoreSense was closer"
                />
              )}
          </div>
        </div>
      )}

      {upsideReport && (
        <div className="metric-group metric-group-compact">
          <h3 className="metric-group-title metric-group-title-plain">Breakout-week detection</h3>
          <div className="summary-grid">
            <SummaryCard
              label="Big-game catch rate"
              value={`${((upsideSummary?.avg_boom_recall ?? 0) * 100).toFixed(0)}%`}
              hint="Spike weeks flagged pre-kickoff"
              primary
            />
            <SummaryCard
              label="Miss on spike weeks"
              value={formatMiss(upsideSummary?.avg_ceiling_mae)}
              hint="Avg. miss on top-scoring games only"
            />
            <SummaryCard
              label="Ceiling covered breakout"
              value={`${((upsideSummary?.avg_boom_p90_coverage ?? 0) * 100).toFixed(0)}%`}
              hint="Big games below high-end projection"
            />
          </div>
          <div className="panel panel-inset">
            <h2 className="chart-heading">Accuracy vs breakout detection by season</h2>
            <div className="chart-wrap chart-wrap-compact">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={upsideChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e40af" strokeOpacity={0.22} />
                  <XAxis dataKey="season" stroke="#94a3b8" />
                  <YAxis
                    yAxisId="left"
                    stroke={COLORS.mae}
                    tick={{ fill: "#60a5fa" }}
                    domain={upsideMaeDomain}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke={COLORS.boom_recall}
                    tick={{ fill: "#4ade80" }}
                    domain={[0, 1]}
                    tickFormatter={(v) => `${Math.round(v * 100)}%`}
                  />
                  <Tooltip content={<DualAxisTooltip />} />
                  <Legend
                    formatter={(value) =>
                      value === "mae" ? "Avg. miss" : value === "boom_recall" ? "Catch rate" : value
                    }
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="mae"
                    name="mae"
                    stroke={COLORS.mae}
                    strokeWidth={2}
                    dot={{ r: 4, fill: COLORS.mae }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="boom_recall"
                    name="boom_recall"
                    stroke={COLORS.boom_recall}
                    strokeWidth={2}
                    dot={{ r: 4, fill: COLORS.boom_recall }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <h2 className="chart-heading">Projection accuracy by season ({seasonRange})</h2>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="season" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a" }}
                formatter={(value) => formatMiss(value)}
              />
              <Legend formatter={(value) => chartName(value)} />
              {activeForecast.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={COLORS[key] || "#94a3b8"}
                  strokeWidth={key === "scoresense" ? 3 : 2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel panel-compact">
        <h2 className="chart-heading">Latest season ({report.seasons[report.seasons.length - 1]})</h2>
        <div className="chart-wrap chart-wrap-compact">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData.slice(-1)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="season" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a" }}
                formatter={(value) => formatMiss(value)}
              />
              <Legend formatter={(value) => chartName(value)} />
              {activeForecast.map((key) => (
                <Bar key={key} dataKey={key} name={key} fill={COLORS[key] || "#64748b"} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div id="accuracy-season">
      <SeasonLongAccuracySection report={seasonLongReport} />
      </div>

      {activeDiagnostic.length > 0 && (
        <details className="panel accuracy-details">
          <summary className="accuracy-details-summary">Reference benchmarks (post-hoc)</summary>
          <p className="chart-caption chart-caption-tight">
            Not fair pre-game comparisons — uses after-the-fact information.
          </p>
          <div className="chart-wrap chart-wrap-compact">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="season" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a" }}
                  formatter={(value) => formatMiss(value)}
                />
                <Legend formatter={(value) => chartName(value)} />
                {activeDiagnostic.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stroke={COLORS[key] || "#64748b"}
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {summary.ffopportunity_avg_mae != null && (
            <p className="chart-note methodology-note">
              Perfect-hindsight EP averaged {formatMiss(summary.ffopportunity_avg_mae)} — expected,
              since it uses actual usage.
            </p>
          )}
        </details>
      )}

      <details className="panel accuracy-details methodology-panel">
        <summary className="accuracy-details-summary">Methodology</summary>
        <ul className="methodology-list">
          <li>
            <strong>Walk-forward</strong> — train on prior seasons only, project each week before
            kickoff.
          </li>
          <li>
            <strong>PPR scoring</strong> — regular season weeks 1–18.
          </li>
          <li>
            <strong>Feature gap analysis</strong> —{" "}
            <code>python scripts/projection_gap_analysis.py</code>
          </li>
          {report.notes && <li>{report.notes}</li>}
        </ul>
      </details>

      {onRebuild && (
        <details className="accuracy-admin">
          <summary className="accuracy-admin-summary">Report maintenance</summary>
          <p className="chart-note accuracy-admin-note">
            Rebuild walk-forward accuracy artifacts for QB, RB, and WR. This can take several minutes.
          </p>
          <button
            type="button"
            className="btn-ghost btn-sm accuracy-admin-btn"
            onClick={onRebuild}
            disabled={rebuildLoading}
          >
            {rebuildLoading ? "Working…" : "Rebuild accuracy report"}
          </button>
        </details>
      )}
        </div>
      </details>
    </div>
  );
}
