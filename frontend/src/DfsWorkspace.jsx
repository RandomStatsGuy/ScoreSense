import React, { useEffect, useMemo, useRef, useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout";
import {
  allocateMatchupWeights,
  DFS_STEP_COPY,
  DFS_WORKSPACE_COPY as C,
  filterObjectives,
  formatSalary,
  gameStackLabel,
  highestTotalGameId,
  matchupWeightLabel,
  slateGames,
  vegasImplied,
  vegasKickoffLabel,
  vegasLineMovement,
  vegasSpreadLabel,
  vegasTotalValue,
} from "./dfsToolPresentation";
import { nflTeamColors } from "./DraftHub/nflTeamColors";
import { buildSiteLineupCsv, buildLineupDetailCsv } from "./dfsExport";
import { readEntryTemplate, buildEntryCsv } from "./dfsEntryExport";
import { moneyCents } from "./dfsCsv";
import { downloadCsv } from "./table";
import { jsonRequest } from "./useDfsBuilder";

const num = (n) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(1);
const options = (values) => values.map((v) => ({ id: v, label: String(v) }));
/** Surname only, so a row of six names still fits. Team defenses keep their name. */
export function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "";
  const tail = parts[parts.length - 1].replace(/[.,]/g, "");
  if (["Jr", "Sr", "II", "III", "IV", "V"].includes(tail)) return parts.slice(-2).join(" ");
  // "St. Brown", "Van Jefferson" — the particle belongs to the surname.
  const prior = parts[parts.length - 2] || "";
  const particle = prior.endsWith(".") || ["Van", "Von", "De", "Del", "La", "St"].includes(prior);
  return particle ? parts.slice(-2).join(" ") : parts[parts.length - 1];
}

/** The captain, named by slot so it reads as a role rather than a stray name. */
function lineupHeadline(entry) {
  const lead = (entry.lineup || []).find((p) => ["CPT", "MVP", "QB"].includes(p.slot));
  if (!lead) return "";
  return `${lead.slot} ${lead.player}`;
}

/** Everyone else, which is the only thing that distinguishes one lineup from another. */
function lineupSupporting(entry) {
  const lead = (entry.lineup || []).find((p) => ["CPT", "MVP", "QB"].includes(p.slot));
  return (entry.lineup || [])
    .filter((p) => p !== lead)
    .map((p) => shortName(p.player))
    .join(" · ");
}

export function DfsFile({ label, onFile, disabled = false, accept = ".csv,text/csv" }) {
  return (
    <label className={`dfw-file-button${disabled ? " is-disabled" : ""}`}>
      {label}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}
export function DfsField({ label, children }) {
  return (
    <div className="dfw-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function DfsMatchupBoard({ b }) {
  const games = useMemo(
    () => slateGames(b.vegasGames, b.pool),
    [b.vegasGames, b.pool],
  );
  const highestId = highestTotalGameId(games);
  const showsLineMoves = games.some((game) => vegasLineMovement(game).hasBaseline);
  const allocation = allocateMatchupWeights(b.stackWeights, b.settings.count);
  if (b.isCaptain) return null;
  return (
    <section className="dfw-panel dfw-matchups" aria-labelledby="dfw-matchups-title">
      <div className="dfw-matchups-head">
        <div>
          <h2 id="dfw-matchups-title">{DFS_STEP_COPY.shootoutTitle}</h2>
          <p className="dfw-note">{DFS_STEP_COPY.shootoutSupport}</p>
          <p className="dfw-note">{DFS_STEP_COPY.impliedNote}</p>
          {showsLineMoves && <p className="dfw-note">{DFS_STEP_COPY.lineMoveNote}</p>}
        </div>
        {!!allocation.length && (
          <button type="button" onClick={b.clearStackWeights}>
            {DFS_STEP_COPY.clearGames}
          </button>
        )}
      </div>
      {!games.length ? (
        <p className="dfw-note">{DFS_STEP_COPY.shootoutEmpty}</p>
      ) : (
        <>
          <div className="dfw-matchup-plan">
            <h3>{DFS_STEP_COPY.lineupPlan}</h3>
            {!allocation.length ? <p className="dfw-note">{DFS_STEP_COPY.noWeightedGames}</p> : allocation.map((entry) => {
              const game = games.find((item) => item.game_id === entry.gameId);
              return game ? <div className="dfw-matchup-plan-row" key={entry.gameId}><span>{gameStackLabel(game)}</span><strong>{DFS_STEP_COPY.lineupAllocation(entry.count)}</strong></div> : null;
            })}
            <p className="dfw-note">{DFS_STEP_COPY.weightOnNote}</p>
          </div>
          <div className="dfw-matchup-grid">
            {games.map((game) => {
              const weight = Number(b.stackWeights[game.game_id]) || 0;
              const movement = vegasLineMovement(game);
              const awayColors = nflTeamColors(game.away);
              const homeColors = nflTeamColors(game.home);
              return (
                <article
                  key={game.game_id}
                  className={`dfw-matchup-card${weight ? " is-active" : ""}`}
                  style={{
                    "--dfw-away-top": awayColors.jersey[0],
                    "--dfw-away-bottom": awayColors.jersey[1],
                    "--dfw-away-mark": awayColors.plate,
                    "--dfw-home-top": homeColors.jersey[0],
                    "--dfw-home-bottom": homeColors.jersey[1],
                    "--dfw-home-mark": homeColors.plate,
                  }}
                >
                  <div className="dfw-matchup-kick">
                    <span>{vegasKickoffLabel(game.kickoff_et, game.weekday)}</span>
                    {game.game_id === highestId && <strong>{DFS_STEP_COPY.highestTotal}</strong>}
                  </div>
                  <div className="dfw-matchup-stage">
                    <div className="dfw-matchup-team dfw-matchup-team--away">
                      <b>{game.away}</b>
                      <span title={DFS_STEP_COPY.impliedTitle}>{vegasImplied(game.away_implied)}</span>
                    </div>
                    <span className="dfw-matchup-at">at</span>
                    <div className="dfw-matchup-team dfw-matchup-team--home">
                      <b>{game.home}</b>
                      <span title={DFS_STEP_COPY.impliedTitle}>{vegasImplied(game.home_implied)}</span>
                    </div>
                  </div>
                  <div className="dfw-matchup-markets" role="group" aria-label={DFS_STEP_COPY.currentLine}>
                    <div>
                      <span>Total</span>
                      <strong>{vegasTotalValue(game)}</strong>
                      <small className={movement.totalChanged ? "has-moved" : ""}>{movement.total}</small>
                    </div>
                    <div>
                      <span>Spread</span>
                      <strong>{vegasSpreadLabel(game)}</strong>
                      <small className={movement.spreadChanged ? "has-moved" : ""}>{movement.spread}</small>
                    </div>
                  </div>
                  <div className="dfw-matchup-weight" role="group" aria-label={`${DFS_STEP_COPY.stackWeight}: ${gameStackLabel(game)}`}>
                    <span>{DFS_STEP_COPY.weightShort}</span>
                    <div>
                      <button type="button" aria-label={`${DFS_STEP_COPY.lowerWeight}: ${gameStackLabel(game)}`} disabled={!weight || b.building} onClick={() => b.changeStackWeight(game.game_id, -1)}>−</button>
                      <strong aria-live="polite">{matchupWeightLabel(weight)}</strong>
                      <button type="button" aria-label={`${DFS_STEP_COPY.raiseWeight}: ${gameStackLabel(game)}`} disabled={weight >= 4 || b.building} onClick={() => b.changeStackWeight(game.game_id, 1)}>+</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export default function DfsWorkspace({ b }) {
  const [tab, setTab] = useState("pool"),
    [query, setQuery] = useState(""),
    [pos, setPos] = useState("ALL"),
    [page, setPage] = useState(0);
  const [sort, setSort] = useState({
    key: "Projected Points",
    descending: true,
  });
  const slateRef = useRef(null),
    lineupsRef = useRef(null);
  const [template, setTemplate] = useState(null),
    [assignments, setAssignments] = useState({}),
    [sameSlate, setSameSlate] = useState(false);
  const lineup = b.lineups[b.selected]?.lineup || [];
  const ids = new Set(lineup.map((p) => p.player_id));
  const eligible = b.pool.filter((p) => !b.isDfs || p.salary != null);
  const filtered = useMemo(
    () =>
      eligible
        .filter(
          (p) =>
            (pos === "ALL" || p.Position === pos) &&
            String(p.Player).toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, z) => {
          const av = a[sort.key],
            zv = z[sort.key];
          if (av == null) return 1;
          if (zv == null) return -1;
          return (
            (typeof av === "string" ? av.localeCompare(zv) : av - zv) *
            (sort.descending ? -1 : 1)
          );
        }),
    [b.pool, b.isDfs, pos, query, sort],
  );
  useEffect(() => setPage(0), [query, pos, b.pool, sort]);
  useEffect(() => {
    setTemplate(null);
    setAssignments({});
    setSameSlate(false);
  }, [b.context.site, b.context.slateId, b.lineups]);
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const salary = lineup.reduce((s, p) => s + Number(p.salary || 0), 0);
  const cap = Number(b.config.salary_cap || 0);
  const exportCheck = buildSiteLineupCsv(b.context.site, b.lineups, b.pool);
  const exposure = useMemo(() => {
    const map = new Map();
    b.lineups.forEach((e) =>
      e.lineup.forEach((p) => {
        const r = map.get(p.player_id) || { ...p, count: 0, captains: 0 };
        r.count++;
        if (["CPT", "MVP"].includes(p.slot)) r.captains++;
        map.set(p.player_id, r);
      }),
    );
    return [...map.values()].sort((a, z) => z.count - a.count);
  }, [b.lineups]);
  const uploadTemplate = async (file) => {
    try {
      if (file) {
        setTemplate(readEntryTemplate(await file.text(), b.context.site));
        setAssignments({});
        setSameSlate(false);
      }
    } catch (e) {
      b.setError(e.message);
    }
  };
  const exportEntries = async () => {
    try {
      const result = buildEntryCsv(template, b.lineups, assignments, b.pool);
      // Saving links the actual reserved entry IDs to the immutable input snapshot.
      const build = b.savedBuild || (await b.save());
      if (!build) return;
      const entries = template.entries
        .filter((e) => assignments[e.id] !== "" && assignments[e.id] != null)
        .map((e) => ({
          site: "draftkings",
          entry_id: e.id,
          contest_id: e.contestId,
          contest_name: e.contest,
          fee_cents: moneyCents(e.fee),
          status: "unsettled",
          build_id: build.id,
          lineup_index: Number(assignments[e.id]),
        }));
      await jsonRequest("/api/lineup/results/import", {
        method: "POST",
        body: JSON.stringify({ entries }),
      });
      downloadCsv(result.filename, result.lines);
    } catch (e) {
      b.setError(e.message);
    }
  };
  const showLineups = () => {
    const target = lineupsRef.current;
    if (!target) return;
    const barHeight = slateRef.current?.offsetHeight || 0;
    const top = target.getBoundingClientRect().top + window.scrollY - barHeight - 16;
    window.scrollTo({ top, behavior: "smooth" });
  };
  const changeSort = (key) =>
    setSort((s) => ({ key, descending: s.key === key ? !s.descending : true }));
  return (
    <>
      <div className="dfw-slate" ref={slateRef}>
        <HubFilterMenu
          label={C.format}
          value={b.context.site}
          options={Object.entries(b.formats).map(([id, c]) => ({
            id,
            label: c.label,
          }))}
          onChange={(site) => b.changeContext({ site })}
          disabled={b.building}
        />
        {b.isDfs && (
          <HubFilterMenu
            label={C.slate}
            value={b.context.slateId}
            options={b.slates.map((s) => ({
              id: String(s.slate_id),
              label: s.name,
            }))}
            onChange={(slateId) => b.changeContext({ slateId })}
            disabled={b.busy || b.building}
          />
        )}
        <small>
          {b.context.source === "upload" ? b.slateName : b.config.description}
        </small>
        <DfsFile
          label={C.salaryImport}
          onFile={b.importSalary}
          disabled={!b.isDfs || b.busy || b.building || !b.context.week}
        />
        <div className="dfw-build">
          {!!b.lineups.length && !b.building && (
            <button type="button" onClick={showLineups}>
              {C.viewLineups(b.lineups.length)}
            </button>
          )}
          <button
            type="button"
            className="dfw-primary dfw-build-button"
            disabled={b.busy || b.building || !b.pool.length}
            onClick={b.run}
          >
            {b.building ? C.building : lineup.length ? C.rebuild : C.build}
          </button>
        </div>
      </div>
      <div className="dfw-workspace">
        <section className="dfw-center">
          <div className="dfw-panel">
            <nav className="dfw-tabs" aria-label={C.pool}>
              {[
                ["pool", C.pool],
                ["exposure", C.exposureTab],
                ["notes", C.notes],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-current={tab === id ? "page" : undefined}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {tab === "pool" && (
              <>
                <div className="dfw-filters">
                  {[
                    "ALL",
                    "QB",
                    "RB",
                    "WR",
                    "TE",
                    ...(b.isDfs ? ["K", "DST"] : []),
                  ].map((p) => (
                    <button
                      key={p}
                      aria-pressed={pos === p}
                      onClick={() => setPos(p)}
                    >
                      {p === "ALL" ? C.all : p}
                    </button>
                  ))}
                </div>
                <input
                  className="dfw-search"
                  aria-label={C.search}
                  placeholder={C.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="dfw-table-scroll">
                  <table className="dfw-table">
                    <thead>
                      <tr>
                        <th>
                          <button onClick={() => changeSort("Player")}>
                            {C.player}
                          </button>
                        </th>
                        {b.isDfs && (
                          <th className="num">
                            <button onClick={() => changeSort("salary")}>
                              {C.used}
                            </button>
                          </th>
                        )}
                        <th className="num">
                          <button
                            onClick={() => changeSort("Projected Points")}
                          >
                            {C.proj}
                          </button>
                        </th>
                        <th className="num">{C.own}</th>
                        {b.isCaptain && <th>{C.captainLimit}</th>}
                        <th className="actions">{C.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.busy
                        ? Array.from({ length: 6 }, (_, i) => (
                            <tr key={i}>
                              <td colSpan={b.isCaptain ? 6 : 5}>
                                <div
                                  className="dfw-skeleton"
                                  aria-label={C.loading}
                                />
                              </td>
                            </tr>
                          ))
                        : filtered.slice(page * 8, page * 8 + 8).map((p) => (
                            <tr
                              key={p.player_id}
                              className={
                                ids.has(p.player_id) ? "is-selected" : ""
                              }
                            >
                              <td>
                                <strong>{p.Player}</strong>
                                <small>
                                  {p.Team} · {p.Position}
                                  {p["Injury Status"]
                                    ? ` · ${p["Injury Status"]}`
                                    : ""}
                                </small>
                                {p.projection_source !== "ScoreSense" && (
                                  <small>{p.projection_source}</small>
                                )}
                              </td>
                              {b.isDfs && (
                                <td className="num">
                                  {formatSalary(p.salary)}
                                </td>
                              )}
                              <td className="num">
                                {num(p["Projected Points"])}
                              </td>
                              <td className="num">
                                {b.ownership[p.player_id] == null
                                  ? "—"
                                  : `${b.ownership[p.player_id]}%`}
                              </td>
                              {b.isCaptain && (
                                <td>
                                  <HubFilterMenu
                                    label={C.captainLimit}
                                    value={b.captainLimits[p.player_id] ?? 1}
                                    options={[0, 0.1, 0.25, 0.5, 1].map(
                                      (v) => ({
                                        id: v,
                                        label:
                                          v === 0 ? C.noCaptain : `${v * 100}%`,
                                      }),
                                    )}
                                    onChange={(v) =>
                                      b.setCaptainLimits((l) => ({
                                        ...l,
                                        [p.player_id]: Number(v),
                                      }))
                                    }
                                  />
                                </td>
                              )}
                              <td className="actions">
                                <div className="dfw-row-actions">
                                  <button
                                    aria-label={`${C.lock} ${p.Player}`}
                                    aria-pressed={b.locked.includes(
                                      p.player_id,
                                    )}
                                    onClick={() =>
                                      b.toggle(p.player_id, "lock")
                                    }
                                  >
                                    {C.lock}
                                  </button>
                                  <button
                                    aria-label={`${C.skip} ${p.Player}`}
                                    aria-pressed={b.excluded.includes(
                                      p.player_id,
                                    )}
                                    onClick={() =>
                                      b.toggle(p.player_id, "skip")
                                    }
                                  >
                                    {C.skip}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
                {!b.busy && !filtered.length && (
                  <p className="dfw-note">{C.noPlayers}</p>
                )}
                <div className="dfw-pagination">
                  <small>
                    {filtered.length} {C.player.toLowerCase()}s ·{" "}
                    {Math.min(page + 1, pages)} / {pages}
                  </small>
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {C.previous}
                  </button>
                  <button
                    disabled={page + 1 >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {C.next}
                  </button>
                </div>
                <div className="dfw-coverage">
                  <small>
                    {
                      eligible.filter((p) => p["Projected Points"] != null)
                        .length
                    }{" "}
                    / {eligible.length} with estimates ·{" "}
                    {
                      eligible.filter(
                        (p) => p.projection_source === "Fixed estimate",
                      ).length
                    }{" "}
                    fixed
                  </small>
                  <p className="dfw-note">{C.missingProjection}</p>
                </div>
                {!Object.keys(b.ownership).length && (
                  <p className="dfw-note">{C.missingOwnership}</p>
                )}
                <DfsFile
                  label={C.projections}
                  onFile={b.importProjections}
                  disabled={!b.pool.length || b.busy || b.building}
                />
                <details>
                  <summary>{C.projectionHelp.split(".")[0]}</summary>
                  <p className="dfw-note">{C.projectionHelp}</p>
                </details>
              </>
            )}
            {tab === "exposure" && (
              <>
                <p className="dfw-note">
                  {b.lineups.length} {C.count.toLowerCase()} · {C.lockNote}
                </p>
                <div className="dfw-table-scroll">
                  <table className="dfw-table">
                    <thead>
                      <tr>
                        <th>{C.player}</th>
                        <th className="num">{C.total}</th>
                        <th className="num">%</th>
                        <th className="num">{C.captainCount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exposure.map((p) => (
                        <tr key={p.player_id}>
                          <td>{p.player}</td>
                          <td className="num">{p.count}</td>
                          <td className="num">
                            {num((p.count / b.lineups.length) * 100)}%
                          </td>
                          <td className="num">{p.captains}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {tab === "notes" && (
              <DfsField label={C.notesLabel}>
                <textarea
                  rows="7"
                  value={b.settings.note}
                  onChange={(e) => b.changeSetting("note", e.target.value)}
                  maxLength={4000}
                />
                <p className="dfw-note">{C.notesHelp}</p>
              </DfsField>
            )}
          </div>
        </section>
        <div className="dfw-rail">
          <section className="dfw-panel dfw-settings" aria-labelledby="dfw-settings-title">
          <h2 id="dfw-settings-title">{C.settings}</h2>
          <div className="dfw-settings-grid">
          <HubFilterMenu
            label={C.season}
            value={b.context.season}
            options={options(
              b.meta?.seasons || [b.context.season].filter(Boolean),
            )}
            onChange={(season) => b.changeContext({ season: Number(season) })}
            disabled={b.building}
          />
          <HubFilterMenu
            label={C.week}
            value={b.context.week}
            options={options(
              b.meta?.weeks_by_season?.[String(b.context.season)] ||
                [b.context.week].filter(Boolean),
            )}
            onChange={(week) => b.changeContext({ week: Number(week) })}
            disabled={b.building}
          />
          <HubFilterMenu
            label={C.count}
            value={b.settings.count}
            options={options([1, 3, 5, 10, 20, 50, 150])}
            onChange={(v) => b.changeSetting("count", Number(v))}
          />
          <HubFilterMenu
            label={C.goal}
            value={b.settings.objective}
            options={filterObjectives(b.isDfs).map((o) => ({
              ...o,
              detail: o.hint,
            }))}
            onChange={(v) => b.changeSetting("objective", v)}
          />
          {b.isCaptain && (
            <HubFilterMenu
              label={C.captain}
              value={b.settings.lockedCaptain}
              options={[
                { id: "", label: C.anyCaptain },
                ...eligible
                  .filter((p) => p["Projected Points"] != null)
                  .map((p) => ({ id: p.player_id, label: p.Player })),
              ]}
              onChange={(v) => b.changeSetting("lockedCaptain", v)}
            />
          )}
          <HubFilterMenu
            label={C.exposure}
            value={b.settings.exposure}
            options={[1, 0.8, 0.7, 0.6, 0.5, 0.3, 0.2].map((v) => ({
              id: v,
              label: `${v * 100}% · ${Math.floor(v * b.settings.count + 1e-9)} / ${b.settings.count}`,
            }))}
            onChange={(v) => b.changeSetting("exposure", Number(v))}
          />
          <HubFilterMenu
            label={C.differences}
            value={b.settings.differences}
            options={options([1, 2, 3, 4])}
            onChange={(v) => b.changeSetting("differences", Number(v))}
          />
          </div>
          {b.isDfs && (
            <DfsField label={C.salary}>
              <div className="dfw-range">
                <input
                  aria-label={C.min}
                  type="number"
                  min="0"
                  max={cap}
                  step="100"
                  value={b.settings.minSalary}
                  onChange={(e) =>
                    b.changeSetting("minSalary", Number(e.target.value))
                  }
                />
                <span>–</span>
                <input
                  aria-label={C.max}
                  type="number"
                  min="0"
                  max={cap}
                  step="100"
                  value={b.settings.maxSalary}
                  onChange={(e) =>
                    b.changeSetting("maxSalary", Number(e.target.value))
                  }
                />
              </div>
            </DfsField>
          )}
          <details>
            <summary>{C.stacks}</summary>
            <div className="dfw-settings-grid">
              {!b.isCaptain && (
                <>
                  <HubFilterMenu
                    label={C.qbStack}
                    value={b.settings.qbStack}
                    options={options([0, 1, 2, 3])}
                    onChange={(v) => b.changeSetting("qbStack", Number(v))}
                  />
                  <label className="dfw-check">
                    <input
                      type="checkbox"
                      checked={b.settings.bringBack}
                      onChange={(e) =>
                        b.changeSetting("bringBack", e.target.checked)
                      }
                    />
                    {C.bringBack}
                  </label>
                </>
              )}
              <HubFilterMenu
                label={C.maxTeam}
                value={b.settings.maxTeam}
                options={options([0, 2, 3, 4, 5])}
                onChange={(v) => b.changeSetting("maxTeam", Number(v))}
              />
              <HubFilterMenu
                label={C.jitter}
                value={b.settings.randomness}
                options={[0, 0.05, 0.12, 0.25].map((v) => ({
                  id: v,
                  label: `${v * 100}%`,
                }))}
                onChange={(v) => b.changeSetting("randomness", Number(v))}
              />
              <p className="dfw-note">{C.jitterNote}</p>
            </div>
          </details>
          <p className="dfw-note">
            {
              filterObjectives(b.isDfs).find(
                (o) => o.id === b.settings.objective,
              )?.hint
            }
          </p>
          <p className="dfw-note">{C.lockNote}</p>
          <p className="dfw-note">{C.contestNote}</p>
        </section>
          <DfsMatchupBoard b={b} />
        </div>
        <div className="dfw-after">
          <section
            ref={lineupsRef}
            id="dfw-lineups"
            className="dfw-panel dfw-lineups"
            aria-labelledby="dfw-lineups-title"
          >
            <div className="dfw-panel-head">
              <h2 id="dfw-lineups-title">
                {b.lineups.length
                  ? `${b.lineups.length} ${C.count.toLowerCase()}`
                  : C.lineupsTitle}
              </h2>
              {!!b.lineups.length && (
                <button
                  type="button"
                  onClick={() => {
                    b.locked.forEach((id) => b.toggle(id, "lock"));
                    b.excluded.forEach((id) => b.toggle(id, "skip"));
                  }}
                >
                  {C.clear}
                </button>
              )}
            </div>
            {!b.lineups.length ? (
              <p className="dfw-note">{C.empty}</p>
            ) : (
              <div className="dfw-lineups-body">
              <div className="dfw-portfolio">
                {b.lineups.map((entry, i) => (
                  <button
                    key={i}
                    aria-pressed={b.selected === i}
                    onClick={() => b.setSelected(i)}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      {lineupHeadline(entry)}
                      <small>
                        {/* The rest of the roster is what actually differs
                            between lineups; the teams never do. */}
                        {lineupSupporting(entry)} · {formatSalary(entry.total_salary)}
                      </small>
                    </span>
                    <span>
                      {num(
                        entry.lineup.reduce(
                          (s, p) => s + Number(p.proj || 0),
                          0,
                        ),
                      )}{" "}
                      pts
                    </span>
                  </button>
                ))}
              </div>
                <div className="dfw-lineup">
                  <div className="dfw-panel-head">
                    <h3>{C.selected}</h3>
                    <small>{`${b.selected + 1} / ${b.lineups.length}`}</small>
                  </div>
          {lineup.map((p, i) => (
            <div
              key={p.slot}
              className={
                i === 0 && b.isCaptain ? "dfw-captain" : "dfw-lineup-row"
              }
            >
              <small>{p.slot}</small>
              <div>
                <strong>{p.player}</strong>
                <small>
                  {p.team} · {p.position}
                </small>
              </div>
              <span>
                {b.isDfs ? formatSalary(p.salary) : `${num(p.proj)} pts`}
              </span>
            </div>
          ))}
          {b.isDfs && !!lineup.length && (
            <>
              <div className="dfw-numbers">
                <div>
                  <small>{C.used}</small>
                  <strong>{formatSalary(salary)}</strong>
                </div>
                <div>
                  <small>{C.unused}</small>
                  <strong>{formatSalary(cap - salary)}</strong>
                </div>
              </div>
              <meter min="0" max={cap} value={salary} aria-label={C.used} />
            </>
          )}
          {!!lineup.length && (
            <>
              <button disabled={Boolean(b.savedBuild)} onClick={b.save}>
                {b.savedBuild ? C.saved : C.save}
              </button>
              <p className="dfw-note">
                {b.savedBuild ? C.savedHelp : C.saveHelp}
              </p>
            </>
          )}
                </div>
              </div>
            )}
          </section>
          <section className="dfw-transfer">
          <div className="dfw-panel">
            <small>{C.newLineups}</small>
            <h2>{C.upload}</h2>
            <p className="dfw-note">{C.uploadHelp}</p>
            <div className="dfw-actions">
              <button
                disabled={!exportCheck.ok}
                onClick={() =>
                  downloadCsv(exportCheck.filename, exportCheck.lines)
                }
              >
                {C.download}
              </button>
              <button
                disabled={!b.lineups.length}
                onClick={() => {
                  const d = buildLineupDetailCsv(b.lineups, { isDfs: b.isDfs });
                  if (d.ok) downloadCsv(d.filename, d.lines);
                }}
              >
                {C.detail}
              </button>
            </div>
            {b.lineups.length && !exportCheck.ok ? (
              <p className="dfw-note">{exportCheck.reason}</p>
            ) : null}
          </div>
          <div className="dfw-panel">
            <small>{C.existing}</small>
            <h2>{C.edit}</h2>
            <p className="dfw-note">{C.editHelp}</p>
            <DfsFile
              label={C.template}
              onFile={uploadTemplate}
              disabled={
                !b.context.site.startsWith("draftkings") || !b.lineups.length
              }
            />
            <details>
              <summary>{C.restriction.split(",")[0]}</summary>
              <p className="dfw-note">{C.restriction}</p>
            </details>
          </div>
        </section>
        {template && (
          <section className="dfw-panel">
            <div className="dfw-panel-head">
              <h2>{C.assignment}</h2>
              <button
                onClick={() =>
                  setAssignments(
                    Object.fromEntries(
                      template.entries
                        .slice(0, b.lineups.length)
                        .map((e, i) => [e.id, i]),
                    ),
                  )
                }
              >
                {C.sequential}
              </button>
            </div>
            <div className="dfw-assignment-list">
              {template.entries.map((e) => (
                <div className="dfw-assignment" key={e.id}>
                  <span>
                    {e.contest}
                    <small>
                      {e.id} · {e.fee}
                    </small>
                  </span>
                  <HubFilterMenu
                    label={C.selected}
                    value={assignments[e.id] ?? ""}
                    options={[
                      { id: "", label: C.keep },
                      ...b.lineups.map((_, i) => ({
                        id: i,
                        label: `${C.selected} ${i + 1}`,
                      })),
                    ]}
                    onChange={(v) => setAssignments((a) => ({ ...a, [e.id]: v }))}
                  />
                </div>
              ))}
            </div>
            <label className="dfw-check">
              <input
                type="checkbox"
                checked={sameSlate}
                onChange={(e) => setSameSlate(e.target.checked)}
              />
              {C.verifySlate}
            </label>
            <button disabled={!sameSlate} onClick={exportEntries}>
              {C.entryDownload}
            </button>
          </section>
        )}
        </div>
      </div>
    </>
  );
}
