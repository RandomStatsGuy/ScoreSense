import React from "react";
import MobileBottomSheet from "./MobileBottomSheet";
import TeamFilter from "../TeamFilter";
import { SEASON_MODES } from "../appNavigation";

const POSITIONS = [
  { id: "qb", label: "QB" },
  { id: "rb", label: "RB" },
  { id: "wr", label: "WR/TE" },
];

export default function MobileFilterSheet({
  open,
  onClose,
  view,
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
}) {
  const showProjectionsFilters = view === "projections";

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      className="app-mobile-sheet-filters"
    >
      <div className="mobile-filter-sheet-body">
        {showProjectionsFilters ? (
          <>
            <div className="mobile-filter-group">
              <span className="mobile-filter-label">Position</span>
              <div className="header-segment mobile-filter-segment" role="group" aria-label="Position">
                {POSITIONS.map((p) => (
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

            {projectionsTab === "season" ? (
              <div className="mobile-filter-group">
                <span className="mobile-filter-label">Season mode</span>
                <div className="mobile-filter-mode-tabs" role="tablist" aria-label="Season mode">
                  {SEASON_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      role="tab"
                      aria-selected={seasonMode === mode.id}
                      className={`season-mode-tab${seasonMode === mode.id ? " active" : ""}`}
                      onClick={() => {
                        seasonModeUserPicked.current = true;
                        onSeasonModeChange(mode.id);
                      }}
                    >
                      <span className="season-mode-tab-label">{mode.shortLabel}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {isWeeklyProjections && season != null ? (
              <>
                <label className="mobile-filter-field">
                  <span className="mobile-filter-label">Season</span>
                  <select
                    className="header-select header-context-control"
                    value={season}
                    onChange={(e) => onSeasonChange(e.target.value)}
                  >
                    {(projMeta?.seasons || []).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="mobile-filter-field">
                  <span className="mobile-filter-label">Week</span>
                  <select
                    className="header-select header-context-control"
                    value={week ?? ""}
                    onChange={(e) => onWeekChange(Number(e.target.value))}
                  >
                    {weekOptions.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </label>
                <TeamFilter
                  className="mobile-filter-team"
                  teams={projMeta?.teams || []}
                  selected={selectedTeams}
                  onChange={onTeamsChange}
                />
              </>
            ) : null}

            {isSeasonPreseason && draftMeta?.seasons?.length > 0 ? (
              <label className="mobile-filter-field">
                <span className="mobile-filter-label">Draft season</span>
                <select
                  className="header-select header-context-control"
                  value={draftSeason ?? ""}
                  onChange={(e) => onDraftSeasonChange(Number(e.target.value))}
                >
                  {draftMeta.seasons.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {isSeasonLive && rosSeason != null ? (
              <>
                <label className="mobile-filter-field">
                  <span className="mobile-filter-label">Season</span>
                  <select
                    className="header-select header-context-control"
                    value={rosSeason}
                    onChange={(e) => onRosSeasonChange(e.target.value)}
                  >
                    {(projMeta?.seasons || []).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="mobile-filter-field">
                  <span className="mobile-filter-label">As of week</span>
                  <select
                    className="header-select header-context-control"
                    value={rosFromWeek ?? ""}
                    onChange={(e) => onRosFromWeekChange(Number(e.target.value))}
                  >
                    {rosWeekOptions.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </>
        ) : (
          <p className="chart-note mobile-filter-empty">No filters for this section.</p>
        )}
      </div>
    </MobileBottomSheet>
  );
}
