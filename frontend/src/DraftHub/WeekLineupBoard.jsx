import React, { useEffect, useState } from "react";
import { HubFilterMenu, HubSection, HubLoadingSkeleton } from "./HubUILayout";
import { fmtNum, formatRelativeTime } from "../format";
import { formatP50Move } from "../projectionMovement";
import {
  PAINT_WIDTH,
  headshotCandidates,
  lookupPlayerMedia,
  paintMediaUrl,
  playerFaceInitials,
  teamLogoUrl,
} from "./draftMedia";
import {
  boardFreshnessLine,
  formatKickoffFact,
  boardTitle,
  clampWeek,
  decisionForStarter,
  emptySlotDoorway,
  indexByPlayerId,
  isSpecialistSlot,
  projectionMissing,
  showVibePts,
  slatePlayerMeta,
  slotTone,
  sitCallLabel,
  startCallAriaLabel,
  startCallLabel,
  swapBenchIdSet,
  WEEK_BOARD_COPY,
  LINEUP_PICKER_COPY,
  WEEK_BOUNDS,
  weekBoardOverlayCopy,
  weekSelectOptions,
} from "./weekBoard";

function fmtPts(value) {
  return value == null || value === "" ? "—" : fmtNum(value, 1);
}

export function RowFace({ player, slot, media }) {
  const [shotIndex, setShotIndex] = useState(0);
  const [logoFailed, setLogoFailed] = useState(false);
  const row = lookupPlayerMedia(media, player?.player_id);
  const shots = headshotCandidates(row, [], { width: PAINT_WIDTH.avatar });
  const headshot = shots[shotIndex] || null;
  const logo = paintMediaUrl(row?.team_logo_url, PAINT_WIDTH.avatar)
    || teamLogoUrl(player?.team, { width: PAINT_WIDTH.avatar });
  const fallback = playerFaceInitials(player, slot || "?");

  useEffect(() => {
    setShotIndex(0);
    setLogoFailed(false);
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
  if (logo && !logoFailed) {
    return <img className="hub-wcc-row-face" src={logo} alt="" onError={() => setLogoFailed(true)} />;
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

function SlotAction({ decision, onOpenCall, compact }) {
  if (!decision) {
    return <div className="hub-wcc-row-action" aria-hidden="true" />;
  }
  const sitLabel = sitCallLabel(decision);
  const startLabel = startCallLabel(decision);
  const open = (event) => {
    event.stopPropagation();
    onOpenCall?.(decision);
  };
  return (
    <div className="hub-wcc-row-action">
      <div className="hub-wcc-call-pills">
        {!compact && <button
          type="button"
          className="hub-wcc-call-pill is-sit"
          aria-label={sitLabel}
          title={decision.starter_player_name ? sitLabel : WEEK_BOARD_COPY.sitRole}
          onClick={open}
        >
          {WEEK_BOARD_COPY.sitRole}
        </button>}
        <button
          type="button"
          className="hub-wcc-call-pill is-start"
          aria-label={startCallAriaLabel(decision)}
          title={decision.bench_player_name ? startLabel : WEEK_BOARD_COPY.startRole}
          onClick={open}
        >
          <span>{WEEK_BOARD_COPY.startRole}</span>
          {decision.delta_p50 != null ? (
            <span className="hub-wcc-slot-call-delta">+{fmtPts(decision.delta_p50)}</span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

function SlateRow({
  slot,
  decision,
  highlighted = false,
  compact = false,
  wide,
  movement,
  vibePts,
  canEdit,
  selected,
  onOpenCall,
  onFillSlot,
  onOpenSlot,
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
        + (empty && isSpecialistSlot(slot) ? " is-doorway" : "")
        + (selected ? " is-target" : "")
        + (highlighted ? " is-pick" : "")
        + (!canEdit ? " is-inert" : "")
      }
      aria-label={label}
    >
      {onOpenSlot ? (
        <button type="button" className="hub-wcc-position-button"
          aria-label={LINEUP_PICKER_COPY.move(player?.player_name || player?.player_id, slot.slot)}
          aria-haspopup="dialog" aria-expanded={Boolean(selected)}
          onClick={() => onOpenSlot(slot)}>{slot.slot === "BN" ? player?.position || "BN" : slot.slot}</button>
      ) : <span className="hub-wcc-row-pos">{slot.slot}</span>}
      {!compact && <RowFace player={player} slot={slot.slot} media={media} />}
      {empty ? (
        <div className="hub-wcc-row-who">
          <strong>{WEEK_BOARD_COPY.emptySlotName}</strong>
          <span>{isSpecialistSlot(slot) ? WEEK_BOARD_COPY.emptySlotHint : slot.slot}</span>
        </div>
      ) : (
        <div className="hub-wcc-row-who">
          <strong>{player.player_name || player.player_id}</strong>
          <span>{compact ? <>{decision && <em className="hub-wcc-sit-mark">{WEEK_BOARD_COPY.sitRole} · </em>}{[player.team, player.on_bye ? "BYE" : formatKickoffFact(player)].filter(Boolean).join(" · ")}</> : slatePlayerMeta(player)}</span>
          {compact && <PlayerFlags player={player} />}
          {compact && wide && !missing && <span className="hub-wcc-range-mark" title={marks.join(" · ")}>{WEEK_BOARD_COPY.legendWide}</span>}
        </div>
      )}
      <div className={`hub-wcc-row-pts${missing ? " is-quiet" : ""}`}>
        {empty || missing ? (
          empty ? null : WEEK_BOARD_COPY.noProjection
        ) : (
          <>
            {fmtPts(player.p50)}
            {!compact && <small>{WEEK_BOARD_COPY.ptsUnit}</small>}
          </>
        )}
      </div>
      {!compact && <div className="hub-wcc-row-mark">
        {marks.length ? (
          <span
            className={wide && !missing ? "is-wide" : undefined}
            title={showVibe ? WEEK_BOARD_COPY.vibeNote : (wide ? WEEK_BOARD_COPY.railWideHint : undefined)}
          >
            {marks.join(" · ")}
          </span>
        ) : null}
        <PlayerFlags player={player} />
      </div>}
      {empty && onFillSlot ? (
        <div className="hub-wcc-row-action">
          <button type="button" className="btn-link hub-wcc-slot-fill" onClick={onFillSlot}>
            {emptySlotDoorway(slot)}
          </button>
        </div>
      ) : (
        <SlotAction decision={decision} onOpenCall={onOpenCall} compact={compact} />
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
  showWeekStepper = true,
  overlayActions = null,
  coverageActions = null,
  refreshAction = null,
  refreshing = false,
  canEdit = false,
  lineupLocked = false,
  sleeperLeagueId = "",
  selectedSlotKey = "",
  onApplyDecision,
  onNavigate,
  onFillSlot,
  onOpenCall,
  onOpenSlot,
  media = {},
  includeChrome = true,
  includeStarters = true,
  includeBench = true,
  compact = false,
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
  const renderRow = (slot, { selected, highlighted = false, showCall = true } = {}) => {
    const player = slot.player;
    const pid = player?.player_id;
    return (
      <SlateRow
        key={slot.key || pid || slot.slot}
        slot={slot}
        decision={showCall ? decisionForStarter(slot, decisions) : null}
        highlighted={highlighted}
        compact={compact}
        wide={pid ? wideById.get(String(pid)) : null}
        movement={pid ? moveById.get(String(pid)) : null}
        vibePts={pid ? vibeById[String(pid)] : null}
        canEdit={canEdit}
        selected={selected}
        onOpenCall={onOpenCall}
        onOpenSlot={onOpenSlot}
        onFillSlot={!pid && onFillSlot ? () => onFillSlot(slot) : undefined}
        media={media}
      />
    );
  };

  const Bench = compact ? HubSection : "div";
  const benchBlock = !emptyRoster && bench.length > 0 ? (
    <Bench className="hub-wcc-bench" {...(compact ? {disclosure:true, title:WEEK_BOARD_COPY.benchTitle, hint:WEEK_BOARD_COPY.benchCount(bench.length), icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>} : {})}>
      {!compact && <h4>{WEEK_BOARD_COPY.benchTitle}</h4>}
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
              selected: selectedSlotKey === `bn-${player.player_id}`,
              highlighted: swapBenchIds.has(String(player.player_id)),
              showCall: false,
            },
          )
        ))}
      </div>
    </Bench>
  ) : null;

  if (!includeChrome && !includeStarters) {
    return benchBlock;
  }

  if (compact && loading) return <HubLoadingSkeleton label="Loading lineup" rows={4} />;
  return (
    <section className={`hub-wcc-board${compact ? " hub-wcc-board--compact" : ""}`} aria-label={boardTitle(weekLabel)}>
      {includeChrome && !compact ? (
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
            {showWeekStepper && <WeekStepper
              weekValue={weekValue}
              weekPlaceholder={weekPlaceholder}
              onWeekChange={onWeekChange}
            />}
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

      {compact && poorCoverage && !hideSlots && <div className="hub-wcc-coverage-block" role="status"><h3>{coverageCopy?.title}</h3><p>{coverageCopy?.body}</p>{coverageActions}</div>}
      {includeStarters ? (
        <div className="hub-wcc-board-stage">
          {compact && !hideSlots && <header className="hub-week-starters-heading"><h3>{WEEK_BOARD_COPY.startersTitle}</h3><span>{WEEK_BOARD_COPY.projected}</span></header>}
          <div className="hub-wcc-slate" id="hub-wcc-calls">
            {hideSlots ? null : slots.map((slot) => renderRow(slot, {
              selected: selectedSlotKey === (slot.key || slot.slot),
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
      {compact && !hideSlots && <div className="hub-week-freshness">
        <span>{freshness.weekBoard || freshness.roster}</span>
        {refreshAction && <button type="button" className="btn-link" onClick={refreshAction} disabled={refreshing}>{refreshing ? WEEK_BOARD_COPY.refreshing : WEEK_BOARD_COPY.refreshProjections}</button>}
      </div>}
    </section>
  );
}
