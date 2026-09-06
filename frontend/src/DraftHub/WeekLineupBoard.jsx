import React, { useEffect, useState } from "react";
import { HubFilterMenu } from "./HubUILayout";
import { fmtNum, formatRelativeTime } from "../format";
import { formatP50Move } from "../projectionMovement";
import {
  PAINT_WIDTH,
  headshotCandidates,
  lookupPlayerMedia,
  paintMediaUrl,
  playerInitials,
  teamLogoUrl,
} from "./draftMedia";
import {
  boardFreshnessLine,
  boardTitle,
  clampWeek,
  decisionForStarter,
  indexByPlayerId,
  projectionMissing,
  showVibePts,
  slatePlayerMeta,
  slotTone,
  startCallLabel,
  swapBenchIdSet,
  WEEK_BOARD_COPY,
  WEEK_BOUNDS,
  weekBoardOverlayCopy,
  weekSelectOptions,
} from "./weekBoard";

function fmtPts(value) {
  return value == null || value === "" ? "—" : fmtNum(value, 1);
}

function RowFace({ player, slot, media }) {
  const [shotIndex, setShotIndex] = useState(0);
  const row = lookupPlayerMedia(media, player?.player_id);
  const shots = headshotCandidates(row, [], { width: PAINT_WIDTH.avatar });
  const headshot = shots[shotIndex] || null;
  const logo = paintMediaUrl(row?.team_logo_url, PAINT_WIDTH.avatar)
    || teamLogoUrl(player?.team, { width: PAINT_WIDTH.avatar });
  const fallback = player ? playerInitials(player.player_name) : (slot || "?");

  useEffect(() => {
    setShotIndex(0);
  }, [player?.player_id, row?.headshot_url, row?.espn_headshot_url]);

  if (headshot) {
    return (
      <img
        className="hub-wcc-row-face"
        src={headshot}
        alt=""
        onError={() => setShotIndex((n) => n + 1)}
      />
    );
  }
  if (logo) {
    return <img className="hub-wcc-row-face" src={logo} alt="" />;
  }
  return (
    <span className="hub-wcc-row-face is-fallback" aria-hidden="true">
      {fallback}
    </span>
  );
}

function PlayerFlags({ player }) {
  const flags = [];
  if (player?.on_bye) flags.push({ key: "bye", label: "BYE", tone: "warn" });
  if (player?.injured) {
    flags.push({
      key: "inj",
      label: player.injury_status || "OUT",
      tone: "danger",
    });
  }
  if (!flags.length) return null;
  return (
    <span className="hub-wcc-flags">
      {flags.map((f) => (
        <span key={f.key} className={`hub-wcc-flag hub-wcc-flag--${f.tone}`}>
          {f.label}
        </span>
      ))}
    </span>
  );
}

function SlotAction({ decision, onOpenCall }) {
  if (!decision) {
    return <div className="hub-wcc-row-action" aria-hidden="true" />;
  }
  const label = startCallLabel(decision);
  const delta = decision.delta_p50 != null ? (
    <span className="hub-wcc-slot-call-delta">+{fmtPts(decision.delta_p50)}</span>
  ) : null;
  return (
    <div className="hub-wcc-row-action">
      <button
        type="button"
        className="hub-wcc-slot-call is-action"
        title={decision.bench_player_name ? `Start ${decision.bench_player_name}` : label}
        onClick={(event) => {
          event.stopPropagation();
          onOpenCall?.(decision);
        }}
      >
        <span>{label}</span>
        {delta}
      </button>
    </div>
  );
}

function SlateRow({
  slot,
  decision,
  highlighted = false,
  wide,
  movement,
  vibePts,
  canEdit,
  selected,
  onSelect,
  onOpenCall,
  onFillSlot,
  media,
}) {
  const player = slot.player;
  const empty = !player;
  const injured = Boolean(player?.injured);
  const onBye = Boolean(player?.on_bye);
  const missing = projectionMissing(player);
  const tone = highlighted && !decision
    ? "swap"
    : slotTone(slot, { decision, wide: false, injured, onBye });
  const moveLabel = formatP50Move(movement?.p50_delta ?? movement?.delta_p50);
  const label = empty
    ? `${slot.slot} slot, empty`
    : `${slot.slot} ${player.player_name || player.player_id}`;
  const showVibe = showVibePts(player, vibePts);
  const marks = [];
  if (wide && !missing && player) {
    marks.push(`${fmtPts(player.p10)}–${fmtPts(player.p90)}`);
  }
  if (showVibe) marks.push(`${WEEK_BOARD_COPY.vibePts} ${fmtPts(vibePts)}`);
  if (moveLabel) marks.push(moveLabel);

  return (
    <article
      className={
        "hub-wcc-row"
        + ` hub-wcc-row--${tone}`
        + (decision ? " is-call" : "")
        + (empty ? " is-empty" : "")
        + (selected ? " is-target" : "")
        + (highlighted ? " is-pick" : "")
        + (canEdit && !empty ? " is-editable" : "")
        + (!canEdit ? " is-inert" : "")
      }
      aria-label={label}
      onClick={canEdit && !empty && onSelect ? () => onSelect(slot) : undefined}
    >
      <span className="hub-wcc-row-pos">{slot.slot}</span>
      <RowFace player={player} slot={slot.slot} media={media} />
      {empty ? (
        <div className="hub-wcc-row-who">
          <strong>{WEEK_BOARD_COPY.emptySlotName}</strong>
          <span>{slot.position === "K" || slot.position === "DEF" ? WEEK_BOARD_COPY.specialistEmpty : slot.slot}</span>
        </div>
      ) : (
        <div className="hub-wcc-row-who">
          <strong>{player.player_name || player.player_id}</strong>
          <span>{slatePlayerMeta(player)}</span>
        </div>
      )}
      <div className={`hub-wcc-row-pts${missing ? " is-quiet" : ""}`}>
        {empty || missing ? (
          empty ? null : WEEK_BOARD_COPY.noProjection
        ) : (
          <>
            {fmtPts(player.p50)}
            <small>{WEEK_BOARD_COPY.ptsUnit}</small>
          </>
        )}
      </div>
      <div className="hub-wcc-row-mark">
        {marks.length ? (
          <span
            className={wide && !missing ? "is-wide" : undefined}
            title={showVibe ? WEEK_BOARD_COPY.vibeNote : (wide ? WEEK_BOARD_COPY.railWideHint : undefined)}
          >
            {marks.join(" · ")}
          </span>
        ) : null}
        <PlayerFlags player={player} />
      </div>
      {empty && onFillSlot ? (
        <div className="hub-wcc-row-action">
          <button type="button" className="btn-link hub-wcc-slot-fill" onClick={onFillSlot}>
            {WEEK_BOARD_COPY.emptySlot(slot.slot)}
          </button>
        </div>
      ) : (
        <SlotAction decision={decision} onOpenCall={onOpenCall} />
      )}
    </article>
  );
}

function WeekStepper({ weekValue, weekPlaceholder, onWeekChange }) {
  const current = clampWeek(weekValue || weekPlaceholder, 1);
  const options = weekSelectOptions(current);
  return (
    <div className="week-stepper hub-wcc-week-stepper">
      <button
        type="button"
        className="week-step-btn"
        aria-label="Previous week"
        disabled={current <= WEEK_BOUNDS.min}
        onClick={() => onWeekChange?.(current - 1)}
      >
        ‹
      </button>
      <HubFilterMenu
        label={WEEK_BOARD_COPY.weekLabel}
        value={current}
        options={options.map((week) => ({ id: week, label: String(week) }))}
        onChange={(id) => onWeekChange?.(Number(id))}
      />
      <button
        type="button"
        className="week-step-btn"
        aria-label="Next week"
        disabled={current >= WEEK_BOUNDS.max}
        onClick={() => onWeekChange?.(current + 1)}
      >
        ›
      </button>
    </div>
  );
}

export default function WeekLineupBoard({
  weekLabel,
  slots = [],
  bench = [],
  decisions = [],
  wideRanges = [],
  projectionChanges = [],
  vibeById = {},
  emptyRoster = false,
  loadFailed = false,
  unlinked = false,
  poorCoverage = false,
  loading = false,
  error = false,
  coverageCopy = null,
  syncedLabel,
  rosterSyncedAt,
  projectionsBuiltAt,
  weekValue,
  weekPlaceholder,
  onWeekChange,
  overlayActions = null,
  coverageActions = null,
  refreshAction = null,
  refreshing = false,
  canEdit = false,
  lineupLocked = false,
  sleeperLeagueId = "",
  selectedBenchId = "",
  onSelectBench,
  onSelectSlot,
  onApplyDecision,
  onNavigate,
  onOpenCall,
  media = {},
  includeChrome = true,
  includeStarters = true,
  includeBench = true,
}) {
  const wideById = indexByPlayerId(wideRanges);
  const moveById = indexByPlayerId(projectionChanges);
  const swapBenchIds = swapBenchIdSet(decisions);
  const hideSlots = loadFailed || error || loading || (emptyRoster && !slots.some((s) => s.player));
  const showOverlay = hideSlots;
  const overlayCopy = weekBoardOverlayCopy({
    loadFailed: loadFailed || error,
    loading,
    emptyRoster,
    unlinked,
  });
  const freshness = boardFreshnessLine({
    rosterAt: rosterSyncedAt,
    weekBoardAt: projectionsBuiltAt,
    rosterLabel: syncedLabel,
    weekLabel: projectionsBuiltAt ? formatRelativeTime(projectionsBuiltAt) : "",
  });
  const renderRow = (slot, { onSelect, selected, highlighted = false, showCall = true } = {}) => {
    const player = slot.player;
    const pid = player?.player_id;
    return (
      <SlateRow
        key={slot.key || pid || slot.slot}
        slot={slot}
        decision={showCall ? decisionForStarter(slot, decisions) : null}
        highlighted={highlighted}
        wide={pid ? wideById.get(String(pid)) : null}
        movement={pid ? moveById.get(String(pid)) : null}
        vibePts={pid ? vibeById[String(pid)] : null}
        canEdit={canEdit}
        selected={selected}
        onSelect={onSelect}
        onOpenCall={onOpenCall}
        onFillSlot={!pid && onNavigate ? () => onNavigate("available") : undefined}
        media={media}
      />
    );
  };

  const benchBlock = !emptyRoster && bench.length > 0 ? (
    <div className="hub-wcc-bench">
      <h4>Bench</h4>
      <div className="hub-wcc-slate hub-wcc-bench-slate">
        {bench.filter((player) => player?.player_id).map((player) => (
          renderRow(
            {
              key: `bn-${player.player_id}`,
              slot: "BN",
              position: player.position,
              player,
            },
            {
              onSelect: onSelectBench
                ? () => onSelectBench(player)
                : undefined,
              selected: String(selectedBenchId) === String(player.player_id),
              highlighted: swapBenchIds.has(String(player.player_id)),
              showCall: false,
            },
          )
        ))}
      </div>
    </div>
  ) : null;

  if (!includeChrome && !includeStarters) {
    return benchBlock;
  }

  return (
    <section className="hub-wcc-board" aria-label={boardTitle(weekLabel)}>
      {includeChrome ? (
        <>
          <header className="hub-wcc-board-head">
            <div>
              <h3>{boardTitle(weekLabel)}</h3>
              <p className="hub-wcc-board-meta">
                {freshness.roster ? (
                  <span className={freshness.rosterStale ? "is-stale" : undefined}>{freshness.roster}</span>
                ) : null}
                {freshness.roster && freshness.weekBoard ? (
                  <span aria-hidden="true"> · </span>
                ) : null}
                {freshness.weekBoard ? <span>{freshness.weekBoard}</span> : null}
                {refreshAction ? (
                  <button
                    type="button"
                    className="btn-link hub-wcc-freshness-refresh"
                    onClick={refreshAction}
                    disabled={refreshing}
                  >
                    {refreshing ? WEEK_BOARD_COPY.refreshing : WEEK_BOARD_COPY.refreshProjections}
                  </button>
                ) : null}
              </p>
            </div>
            <WeekStepper
              weekValue={weekValue}
              weekPlaceholder={weekPlaceholder}
              onWeekChange={onWeekChange}
            />
          </header>

          <p className="hub-wcc-legend" aria-label="Board states">
            <span className="hub-wcc-legend-item is-swap">{WEEK_BOARD_COPY.legendSwap}</span>
            <span className="hub-wcc-legend-item is-wide">{WEEK_BOARD_COPY.legendWide}</span>
          </p>

          {!hideSlots && !emptyRoster ? (
            <p className="hub-wcc-vibe-note">{WEEK_BOARD_COPY.vibeNote}</p>
          ) : null}

          {poorCoverage && !emptyRoster && coverageCopy ? (
            <div className="hub-wcc-coverage-block" role="status">
              <h4 className="hub-wcc-coverage-title">{coverageCopy.title}</h4>
              <p className="hub-wcc-coverage-body">{coverageCopy.body}</p>
              {coverageCopy.hint ? (
                <p className="hub-wcc-coverage-hint">{coverageCopy.hint}</p>
              ) : null}
              {coverageActions ? (
                <div className="hub-wcc-coverage-actions">{coverageActions}</div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {includeStarters ? (
        <div className="hub-wcc-board-stage">
          <div className="hub-wcc-slate" id="hub-wcc-calls">
            {hideSlots ? null : slots.map((slot) => renderRow(slot, {
              onSelect: onSelectSlot,
              selected: Boolean(canEdit && selectedBenchId && slot.player?.player_id),
            }))}
          </div>
          {showOverlay ? (
            <div className="hub-wcc-board-overlay">
              <div className="hub-wcc-board-overlay-card" role="status">
                <h4>{overlayCopy.title}</h4>
                <p>{overlayCopy.body}</p>
                {overlayActions}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {includeBench ? benchBlock : null}
    </section>
  );
}
