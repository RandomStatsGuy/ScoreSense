import React from "react";
import { fmtNum, formatRelativeTime } from "../format";
import { formatP50Move, rowMovementTone } from "../projectionMovement";
import {
  boardFreshnessLine,
  boardTitle,
  clampWeek,
  decisionForStarter,
  emptySpecialistSlots,
  indexByPlayerId,
  lineupCallAction,
  projectionMissing,
  showVibePts,
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

function playerMeta(player) {
  const bits = [player?.position, player?.team].filter(Boolean);
  if (player?.opponent) bits.push(`vs ${player.opponent}`);
  return bits.join(" · ");
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

function SlotAction({ decision, callAction, onApplyDecision }) {
  if (!decision) {
    return <div className="hub-wcc-slot-action" aria-hidden="true" />;
  }
  const label = startCallLabel(decision);
  const delta = decision.delta_p50 != null ? (
    <span className="hub-wcc-slot-call-delta">+{fmtPts(decision.delta_p50)}</span>
  ) : null;
  const title = [
    decision.bench_player_name ? `Start ${decision.bench_player_name}` : label,
    decision.delta_p50 != null ? `+${fmtPts(decision.delta_p50)}` : "",
    callAction?.reason,
  ].filter(Boolean).join(" · ");

  if (callAction?.kind === "sleeper" && callAction.href) {
    return (
      <div className="hub-wcc-slot-action">
        <a
          className="hub-wcc-slot-call is-action"
          href={callAction.href}
          target="_blank"
          rel="noreferrer"
          title={title}
        >
          <span>{label}</span>
          {delta}
        </a>
      </div>
    );
  }

  const locked = callAction?.kind === "locked";
  const clickable = callAction?.kind === "apply" && onApplyDecision;
  const body = (
    <>
      <span>{label}</span>
      {delta}
    </>
  );

  if (clickable) {
    return (
      <div className="hub-wcc-slot-action">
        <button
          type="button"
          className="hub-wcc-slot-call is-action"
          title={title}
          onClick={(event) => {
            event.stopPropagation();
            onApplyDecision(decision);
          }}
        >
          {body}
        </button>
      </div>
    );
  }

  return (
    <div className="hub-wcc-slot-action">
      <button
        type="button"
        className={`hub-wcc-slot-call is-action${locked ? " is-locked" : ""}`}
        title={title}
        disabled={locked}
        onClick={callAction?.kind === "external" ? (event) => event.stopPropagation() : undefined}
      >
        {body}
      </button>
    </div>
  );
}

function SlotCard({
  slot,
  decision,
  highlighted = false,
  wide,
  movement,
  vibePts,
  callAction,
  canEdit,
  selected,
  onSelect,
  onApplyDecision,
  onFillSlot,
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
  const moveTone = movement ? rowMovementTone(movement) : "neutral";
  const label = empty
    ? `${slot.slot} slot, empty`
    : `${slot.slot} ${player.player_name || player.player_id}`;
  const showVibe = showVibePts(player, vibePts);

  return (
    <article
      className={"hub-wcc-slot hub-wcc-slot--" + tone + (decision ? " is-swap" : "") + (empty ? " is-empty" : "") + (selected ? " is-target" : "") + (canEdit && !empty ? " is-editable" : "") + (!canEdit ? " is-inert" : "")}
      aria-label={label}
      onClick={canEdit && !empty && onSelect ? () => onSelect(slot) : undefined}
    >
      <header className="hub-wcc-slot-head">
        <span className="hub-wcc-slot-pos">{slot.slot}</span>
        {moveLabel ? (
          <span className={`hub-wcc-slot-move hub-wcc-slot-move--${moveTone}`}>
            {moveLabel}
          </span>
        ) : null}
      </header>
      {empty ? (
        onFillSlot ? (
          <>
            <p className="hub-wcc-slot-empty-label">Empty</p>
            <button type="button" className="btn-link hub-wcc-slot-fill" onClick={onFillSlot}>
              {WEEK_BOARD_COPY.emptySlot(slot.slot)}
            </button>
          </>
        ) : (
          <p className="hub-wcc-slot-waiting">Empty</p>
        )
      ) : (
        <>
          <div className="hub-wcc-slot-player">
            <strong>{player?.player_name || player?.player_id}</strong>
            <span className="chart-note">{playerMeta(player)}</span>
          </div>
          <div className="hub-wcc-slot-proj">
            <span className={`hub-wcc-slot-p50${missing ? " is-quiet" : ""}`}>
              {missing ? WEEK_BOARD_COPY.noProjection : (
                <>
                  {fmtPts(player.p50)}
                  <span className="hub-wcc-slot-unit">{WEEK_BOARD_COPY.ptsUnit}</span>
                </>
              )}
            </span>
            {wide && !missing ? (
              <span className="hub-wcc-slot-range is-wide" title={WEEK_BOARD_COPY.railWideHint}>
                {fmtPts(player.p10)}–{fmtPts(player.p90)}
              </span>
            ) : null}
            {showVibe ? (
              <span className="hub-wcc-slot-vibe" title={WEEK_BOARD_COPY.vibeNote}>
                {WEEK_BOARD_COPY.vibePts} {fmtPts(vibePts)}
              </span>
            ) : null}
            <PlayerFlags player={player} />
          </div>
        </>
      )}
      <SlotAction
        decision={decision}
        callAction={callAction}
        onApplyDecision={onApplyDecision}
      />
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
      <label className="hub-wcc-week-select">
        <span className="sr-only">{WEEK_BOARD_COPY.weekLabel}</span>
        <select
          className="header-select header-context-control"
          value={current}
          onChange={(event) => onWeekChange?.(Number(event.target.value))}
        >
          {options.map((week) => (
            <option key={week} value={week}>{week}</option>
          ))}
        </select>
      </label>
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
  const callAction = lineupCallAction({ canEdit, lineupLocked, sleeperLeagueId });
  const freshness = boardFreshnessLine({
    rosterAt: rosterSyncedAt,
    weekBoardAt: projectionsBuiltAt,
    rosterLabel: syncedLabel,
    weekLabel: projectionsBuiltAt ? formatRelativeTime(projectionsBuiltAt) : "",
  });
  const specialists = emptySpecialistSlots(slots);

  const renderCard = (slot, { onSelect, selected, highlighted = false, showCall = true } = {}) => {
    const player = slot.player;
    const pid = player?.player_id;
    return (
      <SlotCard
        key={slot.key || pid || slot.slot}
        slot={slot}
        decision={showCall ? decisionForStarter(slot, decisions) : null}
        highlighted={highlighted}
        wide={pid ? wideById.get(String(pid)) : null}
        movement={pid ? moveById.get(String(pid)) : null}
        vibePts={pid ? vibeById[String(pid)] : null}
        callAction={callAction}
        canEdit={canEdit}
        selected={selected}
        onSelect={onSelect}
        onApplyDecision={onApplyDecision}
        onFillSlot={!pid && onNavigate ? () => onNavigate("available") : undefined}
      />
    );
  };

  const benchBlock = !emptyRoster && bench.length > 0 ? (
    <div className="hub-wcc-bench">
      <h4>Bench</h4>
      <div className="hub-wcc-board-grid hub-wcc-bench-grid">
        {bench.filter((player) => player?.player_id).map((player) => (
          renderCard(
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
          <div className="hub-wcc-board-grid" id="hub-wcc-calls">
            {hideSlots ? null : slots.map((slot) => renderCard(slot, {
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
