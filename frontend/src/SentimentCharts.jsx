import React, { useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { fmtNum, fmtMentions, fmtSentiment, mentionCountLabel } from "./format";
import HoverTip, { ChartPortalTooltip, TipLine, TipTitle } from "./HoverTip";
import { aggregateWeekSentiment } from "./sentimentStats";
import { sentimentLabelText } from "./sentimentDisplay";

const CHART_HEIGHT_SM = 220;
const CHART_HEIGHT_MD = 260;

const RECHARTS_TIP_PROPS = {
  wrapperStyle: { visibility: "hidden", pointerEvents: "none" },
  contentStyle: { display: "none" },
  isAnimationActive: false,
};

const STAT_HELP = {
  players: "Players with at least one weighted mention from tracked fantasy YouTube shows.",
  mentions: "Total weighted clip count across covered players from fantasy analyst channels.",
  bullish: "Share of covered players tagged bullish or role-hype. Hover subtext shows bearish + injury share.",
  avg: "Mean sentiment score from −1 (bearish) to +1 (bullish). Near zero = mostly neutral talk.",
  injury: "Players with injury-concern language flagged in transcripts this week.",
  hype: "Players with role-hype / breakout language flagged in transcripts this week.",
};

function StatCard({ label, value, hint, tone, help, mixBar }) {
  return (
    <HoverTip
      variant="dark"
      content={
        <>
          <TipTitle>{label}</TipTitle>
          <TipLine>{help}</TipLine>
          {hint ? <TipLine className="hover-tip-muted">{hint}</TipLine> : null}
        </>
      }
    >
      <div className={`sentiment-stat-card ${tone ? `sentiment-stat-${tone}` : ""}`}>
        {mixBar ? (
          <div className="sentiment-mix-bar" aria-hidden="true">
            <span className="sentiment-mix-bar-pos" style={{ width: `${mixBar.positive}%` }} />
            <span className="sentiment-mix-bar-neg" style={{ width: `${mixBar.negative}%` }} />
          </div>
        ) : null}
        <span className="sentiment-stat-value">{value}</span>
        <span className="sentiment-stat-label">{label}</span>
        {hint ? <span className="sentiment-stat-hint">{hint}</span> : null}
      </div>
    </HoverTip>
  );
}

function ToneTooltip({ active, payload, coordinate, chartRef }) {
  const row = payload?.[0]?.payload;
  if (!row) return null;
  return (
    <ChartPortalTooltip active={active} payload={payload} coordinate={coordinate} chartRef={chartRef}>
      <TipTitle>{row.label}</TipTitle>
      <TipLine>
        {row.count} player{row.count === 1 ? "" : "s"} in this tone bucket
      </TipLine>
    </ChartPortalTooltip>
  );
}

function BuzzTooltip({ active, payload, coordinate, chartRef }) {
  const row = payload?.[0]?.payload;
  if (!row) return null;
  return (
    <ChartPortalTooltip active={active} payload={payload} coordinate={coordinate} chartRef={chartRef}>
      <TipTitle>{row.player}</TipTitle>
      <TipLine>
        {row.team} · {mentionCountLabel(row.mentions)}
      </TipLine>
      <TipLine>
        Sentiment {fmtSentiment(row.score)} · {sentimentLabelText(row.tone)}
      </TipLine>
    </ChartPortalTooltip>
  );
}

function ScatterTooltip({ active, payload, coordinate, chartRef }) {
  const row = payload?.[0]?.payload;
  if (!row) return null;
  return (
    <ChartPortalTooltip active={active} payload={payload} coordinate={coordinate} chartRef={chartRef}>
      <TipTitle>{row.player}</TipTitle>
      <TipLine>{row.team}</TipLine>
      <TipLine>
        {mentionCountLabel(row.mentions)} · sentiment {fmtSentiment(row.score)}
      </TipLine>
    </ChartPortalTooltip>
  );
}

function NetworkTooltip({ active, payload, coordinate, chartRef }) {
  const row = payload?.[0]?.payload;
  if (!row) return null;
  return (
    <ChartPortalTooltip active={active} payload={payload} coordinate={coordinate} chartRef={chartRef}>
      <TipTitle>{row.name}</TipTitle>
      <TipLine>
        {row.count} player mention{row.count === 1 ? "" : "s"} from this source
      </TipLine>
    </ChartPortalTooltip>
  );
}

export default function SentimentCharts({ players, season, week, scope = "weekly" }) {
  const toneChartRef = useRef(null);
  const buzzChartRef = useRef(null);
  const scatterChartRef = useRef(null);
  const networkChartRef = useRef(null);

  const stats = aggregateWeekSentiment(players);

  if (!stats.playerCount) {
    return (
      <div className="sentiment-charts-empty">
        No fantasy narrative data to visualize{scope === "season" ? " for this season" : " for this week"} yet.
      </div>
    );
  }

  const avgLabel =
    stats.avgScore >= 0.15 ? "Leaning bullish" : stats.avgScore <= -0.15 ? "Leaning bearish" : "Mostly neutral";

  return (
    <div className="sentiment-charts">
      <div className="sentiment-stats-row">
        <StatCard label="Players covered" value={stats.playerCount} help={STAT_HELP.players} />
        <StatCard
          label="Total mentions"
          value={fmtNum(stats.totalMentions, 0)}
          hint="weighted clips"
          help={STAT_HELP.mentions}
        />
        <StatCard
          label="Bullish / hype"
          value={`${stats.bullishPct}%`}
          tone="bullish"
          hint={`${stats.bearishPct}% bearish or injury`}
          help={STAT_HELP.bullish}
          mixBar={{ positive: stats.bullishPct, negative: stats.bearishPct }}
        />
        <StatCard
          label="Avg sentiment"
          value={fmtNum(stats.avgScore, 2)}
          hint={avgLabel}
          tone={stats.avgScore >= 0.15 ? "bullish" : stats.avgScore <= -0.15 ? "bearish" : "neutral"}
          help={STAT_HELP.avg}
        />
        <StatCard label="Injury flags" value={stats.injuryFlags} tone="caution" help={STAT_HELP.injury} />
        <StatCard label="Hype flags" value={stats.hypeFlags} tone="hype" help={STAT_HELP.hype} />
      </div>

      <div className="sentiment-charts-grid">
        <div className="sentiment-chart-card">
          <h3 className="sentiment-chart-title">Tone mix</h3>
          <p className="sentiment-chart-caption">
            How players are being talked about{scope === "season" ? " this season" : " this week"} ({season}
            {scope === "season" ? ` through W${week}` : ` W${week}`})
          </p>
          <div ref={toneChartRef} className="chart-wrap sentiment-chart-wrap-sm">
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_SM}>
              <PieChart>
                <Pie
                  data={stats.toneChartData}
                  dataKey="count"
                  nameKey="label"
                  innerRadius="52%"
                  outerRadius="78%"
                  paddingAngle={2}
                >
                  {stats.toneChartData.map((entry) => (
                    <Cell key={entry.tone} fill={entry.fill} stroke="#0f172a" strokeWidth={1} />
                  ))}
                </Pie>
                <Tooltip
                  content={(props) => <ToneTooltip {...props} chartRef={toneChartRef} />}
                  {...RECHARTS_TIP_PROPS}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="sentiment-tone-legend">
            {stats.toneChartData.map((row) => (
              <li key={row.tone}>
                <span className="sentiment-tone-swatch" style={{ background: row.fill }} />
                {row.label} ({row.count})
              </li>
            ))}
          </ul>
        </div>

        <div className="sentiment-chart-card sentiment-chart-card-wide">
          <h3 className="sentiment-chart-title">Most buzz</h3>
          <p className="sentiment-chart-caption">
            Players with the most fantasy analyst mentions — bar color = tone
          </p>
          <div ref={buzzChartRef} className="chart-wrap sentiment-chart-wrap-md">
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_MD}>
              <BarChart
                data={stats.buzzLeaders}
                layout="vertical"
                margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="shortName"
                  stroke="#94a3b8"
                  fontSize={11}
                  width={72}
                  tickLine={false}
                />
                <Tooltip
                  content={(props) => <BuzzTooltip {...props} chartRef={buzzChartRef} />}
                  {...RECHARTS_TIP_PROPS}
                />
                <Bar dataKey="mentions" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {stats.buzzLeaders.map((entry) => (
                    <Cell key={entry.player} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="sentiment-chart-card sentiment-chart-card-wide">
          <h3 className="sentiment-chart-title">Buzz vs tone</h3>
          <p className="sentiment-chart-caption">
            Mention volume (bubble size) vs sentiment score — up-right = lots of positive talk
          </p>
          <div ref={scatterChartRef} className="chart-wrap sentiment-chart-wrap-md">
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_MD}>
              <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="score"
                  name="Sentiment"
                  domain={[-1, 1]}
                  stroke="#94a3b8"
                  fontSize={11}
                  tickCount={5}
                />
                <YAxis
                  type="number"
                  dataKey="mentions"
                  name="Mentions"
                  stroke="#94a3b8"
                  fontSize={11}
                  allowDecimals={false}
                />
                <ZAxis type="number" dataKey="mentions" range={[80, 400]} />
                <Tooltip
                  content={(props) => <ScatterTooltip {...props} chartRef={scatterChartRef} />}
                  {...RECHARTS_TIP_PROPS}
                />
                <Scatter data={stats.spectrumData} fill="#6366f1" fillOpacity={0.85} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {stats.networkChartData.length > 0 && (
          <div className="sentiment-chart-card">
            <h3 className="sentiment-chart-title">Sources</h3>
            <p className="sentiment-chart-caption">Which fantasy shows drove mentions</p>
            <div ref={networkChartRef} className="chart-wrap sentiment-chart-wrap-sm">
              <ResponsiveContainer width="100%" height={CHART_HEIGHT_SM}>
                <BarChart
                  data={stats.networkChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 8, left: 4, bottom: 4 }}
                >
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#94a3b8"
                    fontSize={10}
                    width={96}
                    tickLine={false}
                  />
                  <Tooltip
                    content={(props) => <NetworkTooltip {...props} chartRef={networkChartRef} />}
                    {...RECHARTS_TIP_PROPS}
                  />
                  <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} maxBarSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
