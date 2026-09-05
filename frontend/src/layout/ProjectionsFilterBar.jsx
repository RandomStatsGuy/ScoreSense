import React from "react";
import { HubFilterMenu } from "../DraftHub/HubUILayout";
import TeamFilter from "../TeamFilter";
import { SEASON_MODES } from "../appNavigation";

export const PROJECTION_POSITIONS = [
  { id: "qb", label: "QB" },
  { id: "rb", label: "RB" },
  { id: "wr", label: "WR/TE" },
];

export function ProjectionsFilterControls({
  layout = "bar",
  projectionsTab,
  seasonMode,
  position,
  onPositionChange,
  isWeeklyProjections,
  isSeasonPreseason,
  isSeasonLive,
  projMeta,
  season,
  week,
  weekOptions,
  onSeasonChange,
  onWeekChange,
  selectedTeams,
  onTeamsChange,
  draftMeta,
  draftSeason,
  onDraftSeasonChange,
  rosSeason,
  rosFromWeek,
  rosWeekOptions,
  onRosSeasonChange,
  onRosFromWeekChange,
  seasonModeUserPicked,
  onSeasonModeChange,
  searchQuery,
  onSearchChange,
  movementFilters = [],
  movementFilter,
  onMovementFilterChange,
}) {
  const isSheet = layout === "sheet";
  const weekIdx = week != null && weekOptions ? weekOptions.indexOf(week) : -1;
  const canStepPrev = weekIdx > 0;
  const canStepNext = weekIdx >= 0 && weekIdx < (weekOptions?.length || 0) - 1;

  return (
    <>
      <div className={isSheet ? "mobile-filter-group" : "projections-filter-pos"}>
        {isSheet ? <span className="mobile-filter-label">Position</span> : null}
        <div className={`header-segment ${isSheet ? "mobile-filter-segment" : "projections-filter-pos-segment"}`} role="group" aria-label="Position">
          {PROJECTION_POSITIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`tab header-segment-tab ${position === p.id ? "active" : ""}`}
              onClick={() => onPositionChange(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isSheet && isWeeklyProjections && movementFilters.length ? (
        <div className="mobile-filter-group">
          <span className="mobile-filter-label">What changed</span>
          <div className="header-segment mobile-filter-segment" role="group" aria-label="Board filters">
            {movementFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`tab header-segment-tab ${movementFilter === filter.id ? "active" : ""}`}
                onClick={() => onMovementFilterChange?.(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {projectionsTab === "season" ? (
        <div className={isSheet ? "mobile-filter-group" : "projections-filter-season-mode"}>
          {isSheet ? <span className="mobile-filter-label">Season mode</span> : null}
          <div
            className={isSheet ? "mobile-filter-mode-tabs" : "season-mode-tabs projections-filter-season-tabs"}
            role="tablist"
            aria-label="Season mode"
          >
            {SEASON_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={seasonMode === mode.id}
                className={`season-mode-tab${seasonMode === mode.id ? " active" : ""}`}
                onClick={() => {
                  if (seasonModeUserPicked?.current) seasonModeUserPicked.current = true;
                  onSeasonModeChange?.(mode.id);
                }}
              >
                <span className="season-mode-tab-label">{mode.shortLabel}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className={`projections-filter-context${
          isWeeklyProjections
            ? " projections-filter-context--triple"
            : isSeasonLive
              ? " projections-filter-context--double"
              : " projections-filter-context--single"
        }${isSheet ? " projections-filter-context--sheet" : ""}`}
      >
        {isWeeklyProjections && season != null ? (
          <>
            {isSheet ? (
              <label className="mobile-filter-field">
                <span className="mobile-filter-label">Search</span>
                <input
                  type="search"
                  className="search-input"
                  placeholder="Search the board"
                  value={searchQuery || ""}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  aria-label="Search player or team"
                />
              </label>
            ) : (
              <label className="header-inline-field header-context-field projections-filter-search">
                <span className="header-field-label">Search</span>
                <input
                  type="search"
                  className="search-input header-context-control"
                  placeholder="Search the board"
                  value={searchQuery || ""}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  aria-label="Search player or team"
                />
              </label>
            )}
            <div className={isSheet ? "mobile-filter-field" : "header-inline-field header-context-field"}>
              <HubFilterMenu
                label="Season"
                value={season}
                options={(projMeta?.seasons || []).map((s) => ({ id: s, label: String(s) }))}
                onChange={onSeasonChange}
              />
            </div>
            <div className={isSheet ? "mobile-filter-field" : "header-inline-field header-context-field"}>
              <span className={isSheet ? "mobile-filter-label" : "header-field-label"}>Week</span>
              <div className="week-stepper">
                <button
                  type="button"
                  className="week-step-btn"
                  aria-label="Previous week"
                  disabled={!canStepPrev}
                  onClick={() => onWeekChange(weekOptions[weekIdx - 1])}
                >
                  ‹
                </button>
                <HubFilterMenu
                  label="Week"
                  value={week ?? ""}
                  options={weekOptions.map((w) => ({ id: w, label: String(w) }))}
                  onChange={(id) => onWeekChange(Number(id))}
                />
                <button
                  type="button"
                  className="week-step-btn"
                  aria-label="Next week"
                  disabled={!canStepNext}
                  onClick={() => onWeekChange(weekOptions[weekIdx + 1])}
                >
                  ›
                </button>
              </div>
            </div>
            <TeamFilter
              className={isSheet ? "mobile-filter-team" : "header-context-field header-context-field--team"}
              teams={projMeta?.teams || []}
              selected={selectedTeams}
              onChange={onTeamsChange}
              variant={isSheet ? "sheet" : "menu"}
            />
          </>
        ) : null}

        {isSeasonPreseason && draftMeta?.seasons?.length > 0 ? (
          <div className={isSheet ? "mobile-filter-field" : "header-inline-field header-context-field"}>
            <HubFilterMenu
              label="Draft"
              value={draftSeason ?? ""}
              options={draftMeta.seasons.map((s) => ({ id: s, label: String(s) }))}
              onChange={(id) => onDraftSeasonChange(Number(id))}
            />
          </div>
        ) : null}

        {isSeasonLive && rosSeason != null ? (
          <>
            <div className={isSheet ? "mobile-filter-field" : "header-inline-field header-context-field"}>
              <HubFilterMenu
                label="Season"
                value={rosSeason}
                options={(projMeta?.seasons || []).map((s) => ({ id: s, label: String(s) }))}
                onChange={onRosSeasonChange}
              />
            </div>
            <div className={isSheet ? "mobile-filter-field" : "header-inline-field header-context-field"}>
              <HubFilterMenu
                label="As of"
                value={rosFromWeek ?? ""}
                options={rosWeekOptions.map((w) => ({ id: w, label: String(w) }))}
                onChange={(id) => onRosFromWeekChange(Number(id))}
              />
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

export default function ProjectionsFilterBar(props) {
  return (
    <div className="projections-filter-bar" role="region" aria-label="Projection filters">
      <div className="projections-filter-bar-inner">
        <ProjectionsFilterControls layout="bar" {...props} />
        <p className="projections-filter-scoring-note chart-note" title="ScoreSense weekly model is trained on PPR scoring">
          Scoring: PPR
        </p>
      </div>
    </div>
  );
}
