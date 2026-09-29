import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DFS_RESULTS_COPY } from "./dfsToolPresentation";
import { shortName } from "./DfsWorkspace";
import { spacedLabels } from "./dfsContest.js";
import useChartTokens from "./chartTokens";
import useMobileLayout from "./useMobileLayout";

const C = DFS_RESULTS_COPY.contestReport;

const pct1 = (v) => (v == null || Number.isNaN(v) ? "—" : `${Number(v).toFixed(1)}%`);
const pct0 = (v) => (v == null || Number.isNaN(v) ? "—" : `${Math.round(Number(v))}%`);
const pts = (v) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(1));

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The key is HTML rather than a recharts <Legend>, so the hollow mark can be
 * drawn as an actual ring. Identity never rests on color alone: one hue does
 * the work and fill, size and the label carry the rest.
 */
function ChartKey({ items }) {
  return (
    <ul className="dfs-chart-key">
      {items.map((item) => (
        <li key={item.label}>
          <span className={`dfs-chart-swatch dfs-chart-swatch--${item.mark}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Dots are drawn by hand so both marks clear an 8px hit target and the filled
 * one keeps a 2px surface ring where it overlaps the crowd. Recharts' default
 * symbol is smaller than either.
 */
function ContextDot({ cx, cy, stroke }) {
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={4.5} fill="none" stroke={stroke} strokeWidth={1.5} />;
}

function MineDot({ cx, cy, fill, stroke }) {
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={6} fill={fill} stroke={stroke} strokeWidth={2} />;
}

function PlayerTooltip({ active, payload }) {
  const row = active && payload?.length ? payload[0].payload : null;
  if (!row) return null;
  return (
    <div className="chart-tooltip">
      <span className="chart-tooltip-year">
        {row.player} · {row.roster_position || "—"}
      </span>
      <div className="chart-tooltip-row">
        <span>{C.fieldOwn}</span>
        <strong>{pct1(row.drafted_pct)}</strong>
      </div>
      <div className="chart-tooltip-row">
        <span>{C.fpts}</span>
        <strong>{pts(row.fpts)}</strong>
      </div>
      {row.winners_pct != null && (
        <div className="chart-tooltip-row">
          <span>{C.winnersOwn}</span>
          <strong>{pct1(row.winners_pct)}</strong>
        </div>
      )}
      {row.mine_pct != null && (
        <div className="chart-tooltip-row">
          <span>{C.mineOwn}</span>
          <strong>{pct1(row.mine_pct)}</strong>
        </div>
      )}
    </div>
  );
}

/**
 * What the slate owned against what it scored.
 *
 * Ownership on x, actual points on y, so the top-left corner holds the players
 * who scored without the field on them. The median lines are the field's own,
 * not a target — nothing here is a projection.
 */
export function OwnershipScatter({ ownership = [] }) {
  const t = useChartTokens();
  const mobile = useMobileLayout();
  const labels = mobile ? 3 : 6;
  const rows = useMemo(() => {
    const kept = ownership
      .filter((r) => Number.isFinite(r.drafted_pct) && Number.isFinite(r.fpts))
      .map((r) => ({ ...r, id: `${r.player}|${r.roster_position}`, label: shortName(r.player) }));
    // Names go to the viewer's own players when there are any, and to the
    // highest scorers otherwise — the tooltip carries everyone else.
    const named = kept.some((r) => r.mine_count > 0)
      ? kept.filter((r) => r.mine_count > 0)
      : kept;
    const keys = new Set(
      spacedLabels(
        named.map((r) => ({ key: r.id, x: r.drafted_pct, y: r.fpts, weight: r.fpts })),
        { limit: labels, minGap: mobile ? 0.2 : 0.14 },
      ),
    );
    return kept.map((r) => ({ ...r, tag: keys.has(r.id) ? r.label : "" }));
  }, [ownership, labels, mobile]);
  const mine = rows.filter((r) => r.mine_count > 0);
  const rest = mine.length ? rows.filter((r) => !r.mine_count) : rows;
  const midOwn = median(rows.map((r) => r.drafted_pct));
  const midPts = median(rows.map((r) => r.fpts));

  if (rows.length < 3) return <p className="dfw-note">{C.chartNoPlayers}</p>;

  return (
    <div className="dfs-chart">
      <h3>{C.scatterTitle}</h3>
      <p className="dfw-note">{C.scatterHelp}</p>
      <ResponsiveContainer width="100%" height={mobile ? 300 : 340}>
        <ScatterChart margin={{ top: 16, right: mobile ? 16 : 24, bottom: 24, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} />
          <XAxis
            type="number"
            dataKey="drafted_pct"
            name={C.fieldOwn}
            unit="%"
            stroke={t.muted}
            tick={{ fill: t.muted, fontSize: 12 }}
            label={{ value: C.scatterX, position: "insideBottom", offset: -6, fill: t.muted, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="fpts"
            name={C.fpts}
            stroke={t.muted}
            tick={{ fill: t.muted, fontSize: 12 }}
            label={{ value: C.scatterY, angle: -90, position: "insideLeft", fill: t.muted, fontSize: 12 }}
          />
          {midOwn != null && <ReferenceLine x={midOwn} stroke={t.muted} strokeDasharray="4 4" />}
          {midPts != null && <ReferenceLine y={midPts} stroke={t.muted} strokeDasharray="4 4" />}
          <Tooltip content={<PlayerTooltip />} cursor={{ strokeDasharray: "3 3", stroke: t.muted }} />
          <Scatter
            data={rest}
            fill={t.accent}
            stroke={mine.length ? t.muted : t.surface}
            shape={mine.length ? <ContextDot /> : <MineDot />}
            isAnimationActive={false}
          >
            {mine.length === 0 && (
              <LabelList dataKey="tag" position="top" offset={8} fill={t.ink} fontSize={11} />
            )}
          </Scatter>
          {mine.length > 0 && (
            <Scatter data={mine} fill={t.accent} stroke={t.surface} shape={<MineDot />} isAnimationActive={false}>
              <LabelList dataKey="tag" position="top" offset={8} fill={t.ink} fontSize={11} />
            </Scatter>
          )}
        </ScatterChart>
      </ResponsiveContainer>
      {mine.length > 0 && (
        <ChartKey
          items={[
            { mark: "filled", label: C.keyMine },
            { mark: "hollow", label: C.keyRest },
          ]}
        />
      )}
      <p className="dfw-note">{C.scatterRead}</p>
    </div>
  );
}

/**
 * What the top of the leaderboard rostered, against what the whole field did.
 *
 * The filled bar is the winners, the outlined bar is the field. Both are the
 * same measure on one axis — there is no second scale here.
 */
export function WinnersBoard({ ownership = [], winners = {} }) {
  const t = useChartTokens();
  const mobile = useMobileLayout();
  const limit = mobile ? 8 : 12;
  const rows = useMemo(
    () =>
      ownership
        .filter((r) => r.winners_pct != null && r.winners_pct > 0)
        .sort((a, b) => b.winners_pct - a.winners_pct)
        .slice(0, limit)
        .map((r) => ({
          ...r,
          label: `${shortName(r.player)} ${r.roster_position || ""}`.trim(),
        })),
    [ownership, limit],
  );
  const topCaptain = useMemo(
    () =>
      [...ownership]
        .filter((r) => String(r.roster_position || "").toUpperCase() === "CPT" && r.winners_pct > 0)
        .sort((a, b) => b.winners_pct - a.winners_pct)[0] || null,
    [ownership],
  );

  if (!winners.entries || !rows.length) return <p className="dfw-note">{C.chartNoPlayers}</p>;

  return (
    <div className="dfs-chart">
      <h3>{C.winnersTitle}</h3>
      <p className="dfw-note">
        {winners.whole_field
          ? C.winnersWholeField(winners.entries)
          : C.winnersScope(winners.entries, winners.cutoff_rank, winners.top_pct)}
      </p>
      {topCaptain && (
        <p className="dfs-chart-lead">
          {C.winnersCaptain(topCaptain.player, pct0(topCaptain.winners_pct), pct0(topCaptain.drafted_pct))}
        </p>
      )}
      <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 34 + 48)}>
        <BarChart
          data={rows}
          layout="vertical"
          barGap={2}
          margin={{ top: 8, right: mobile ? 44 : 52, bottom: 8, left: mobile ? 0 : 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
          <XAxis
            type="number"
            unit="%"
            stroke={t.muted}
            tick={{ fill: t.muted, fontSize: 12 }}
            domain={[0, (max) => Math.min(100, Math.ceil(max / 10) * 10)]}
            tickCount={mobile ? 3 : 6}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={mobile ? 116 : 132}
            stroke={t.muted}
            tick={{ fill: t.ink, fontSize: 12 }}
            interval={0}
          />
          <Tooltip content={<PlayerTooltip />} cursor={{ fill: t.grid, fillOpacity: 0.35 }} />
          <Bar dataKey="drafted_pct" fill="none" stroke={t.muted} strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          <Bar dataKey="winners_pct" fill={t.accent} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="winners_pct" position="right" formatter={pct0} fill={t.ink} fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ChartKey
        items={[
          { mark: "filled", label: C.keyWinners },
          { mark: "outline", label: C.keyField },
        ]}
      />
      <p className="dfw-note">{C.winnersRead}</p>
    </div>
  );
}
