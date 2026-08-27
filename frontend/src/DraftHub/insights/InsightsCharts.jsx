import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { POS_COLORS, formatSpendValue } from "./insightsPresentation";

const RECHARTS_STATIC = { isAnimationActive: false };

export function CapSpendCharts({
  barData,
  pieData,
  teams,
  teamPick,
  onTeamPick,
  activePositions,
  spendMetric,
  capSeason,
  chartXTick,
  chartBottomMargin,
  mobileLayout,
}) {
  const mode = spendMetric === "pct" ? "pct" : "dollars";
  const showPie = pieData.length > 0;
  return (
    <div className="hub-insights-grid">
      <div className="hub-insights-chart-panel">
        <h3>Stacked spend</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            key={`${capSeason}-${barData.length}-${activePositions.join(",")}`}
            data={barData}
            margin={{ top: 8, right: 8, left: 0, bottom: chartBottomMargin }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="name" tick={chartXTick} interval={mobileLayout ? "preserveStartEnd" : 0} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => (mode === "pct" ? `${v}%` : `$${v}`)}
            />
            <Tooltip formatter={(v) => formatSpendValue(v, mode)} />
            <Legend />
            {activePositions.map((p) => (
              <Bar
                key={p}
                dataKey={p}
                stackId="pos"
                fill={POS_COLORS[p] || "#94a3b8"}
                {...RECHARTS_STATIC}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {showPie && (
        <div className="hub-insights-chart-panel">
          <h3>Team breakdown</h3>
          <select className="search-input" value={teamPick} onChange={(e) => onTeamPick(e.target.value)}>
            {(teams || []).map((t) => (
              <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
            ))}
          </select>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
                {...RECHARTS_STATIC}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatSpendValue(v, mode)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function ScoringWeekChart({
  data,
  teams,
  colorByTeam,
  dashByTeam,
  hoveredTeam,
  onHover,
  onLegendClick,
  chartXTick,
  chartBottomMargin,
  mobileLayout,
}) {
  return (
    <div className="hub-insights-chart-panel">
      <h3>Points by week</h3>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: chartBottomMargin }}
          onMouseLeave={() => onHover("")}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey="week" tick={chartXTick} interval={mobileLayout ? "preserveStartEnd" : 0} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend
            className="hub-insights-chart-legend"
            onClick={onLegendClick}
            wrapperStyle={{ cursor: "pointer" }}
          />
          {teams.map((name) => {
            const active = !hoveredTeam || hoveredTeam === name;
            const emphasized = hoveredTeam === name;
            return (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={colorByTeam[name] || "#94a3b8"}
                strokeDasharray={dashByTeam[name]}
                strokeOpacity={active ? 1 : 0.22}
                strokeWidth={emphasized ? 3 : 2}
                dot={emphasized ? { r: 3, strokeWidth: 0 } : false}
                activeDot={emphasized ? { r: 5 } : false}
                onMouseEnter={() => onHover(name)}
                onMouseLeave={() => onHover("")}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function InsightsCharts({ kind, ...props }) {
  if (kind === "scoring") return <ScoringWeekChart {...props} />;
  return <CapSpendCharts {...props} />;
}
