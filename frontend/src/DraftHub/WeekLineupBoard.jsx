import React from "react";
import { fmtNum, formatRelativeTime } from "../format";
import { formatP50Move, rowMovementTone } from "../projectionMovement";
import {
  boardTitle,
  decisionForStarter,
  indexByPlayerId,
  slotTone,
  swapBenchIdSet,
  WEEK_BOARD_COPY,
  weekBoardOverlayCopy,
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
  if (player?.projection_missing || player?.has_projection === false) {
    flags.push({ key: "miss", label: "No proj", tone: "muted" });
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

function SlotCard({ slot, decision, wide, movement, canEdit, selected, onSelect, onApplyDecision, onFillSlot }) {
  const player = slot.player;
  const empty = !player;
  const injured = Boolean(player?.injured);
  const onBye = Boolean(player?.on_bye);
  const tone = slotTone(slot, { decision, wide: Boolean(wide), injured, onBye });
  const moveLabel = formatP50Move(movement?.p50_delta ?? movement?.delta_p50);
  const moveTone = movement ? rowMovementTone(movement) : "neutral";
  const label = empty
    ? `${slot.slot} slot, empty`
    : `${slot.slot} ${player.player_name || player.player_id}`;

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
          <button type="button" className="btn-link hub-wcc-slot-fill" onClick={onFillSlot}>
            {WEEK_BOARD_COPY.emptySlot(slot.slot)}
          </button>
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
            <span className="hub-wcc-slot-p50">
              {player.has_projection === false ? "—" : fmtPts(player.p50)}
            </span>
            {wide ? (
              <span className="hub-wcc-slot-range">
                {fmtPts(player.p10)}–{fmtPts(player.p90)}
              </span>
            ) : null}
            <PlayerFlags player={player} />
          </div>
        </>
      )}
      {decision ? (
        canEdit && onApplyDecision ? (
          <button
            type="button"
            className="hub-wcc-slot-call is-action"
            onClick={(event) => {
              event.stopPropagation();
              onApplyDecision(decision);
            }}
          >
            <span>Start {decision.bench_player_name}</span>
            {decision.delta_p50 != null ? (
              <span className="hub-wcc-slot-call-delta">+{fmtPts(decision.delta_p50)}</span>
            ) : null}
          </button>
        ) : (
          <p className="hub-wcc-slot-call">
            <span>Start {decision.bench_player_name}</span>
            {decision.delta_p50 != null ? (
              <span className="hub-wcc-slot-call-delta">+{fmtPts(decision.delta_p50)}</span>
            ) : null}
          </p>
        )
      ) : null}
    </article>
  );
}

function BenchChip({ player, highlighted, selected, canEdit, onSelect }) {
  const className = `hub-wcc-bench-chip${highlighted ? " is-swap" : ""}${selected ? " is-selected" : ""}${canEdit ? " is-action" : ""}`;
  const body = (
    <>
      <span className="hub-wcc-slot-pos">BN</span>
      <span className="hub-wcc-bench-chip-main">
        <strong>{player?.player_name || player?.player_id}</strong>
        <span className="chart-note">{playerMeta(player)}</span>
      </span>
      <span className="hub-wcc-slot-p50">
        {player?.has_projection === false ? "—" : fmtPts(player?.p50)}
      </span>
      <PlayerFlags player={player} />
    </>
  );
  return (
    <li>
      {canEdit && onSelect ? (
        <button type="button" className={className} onClick={() => onSelect(player)}>
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

export default function WeekLineupBoard({
  weekLabel,
  slots = [],
  bench = [],
  decisions = [],
  wideRanges = [],
  projectionChanges = [],
  emptyRoster = false,
  loadFailed = false,
  unlinked = false,
  poorCoverage = false,
  loading = false,
  error = false,
  coverageCopy = null,
  syncedLabel,
  projectionsBuiltAt,
  weekValue,
  weekPlaceholder,
  onWeekChange,
  overlayActions = null,
  coverageActions = null,
  canEdit = false,
  selectedBenchId = "",
  onSelectBench,
  onSelectSlot,
  onApplyDecision,
  onNavigate,
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

  return (
    <section className="hub-wcc-board" aria-label={boardTitle(weekLabel)}>
      <header className="hub-wcc-board-head">
        <div>
          <h3>{boardTitle(weekLabel)}</h3>
          <p className="hub-wcc-board-meta">
            Roster {syncedLabel || "—"}
            {projectionsBuiltAt
              ? ` · Projections ${formatRelativeTime(projectionsBuiltAt) || "available"}`
              : ""}
          </p>
          <p className="hub-wcc-board-meta">{WEEK_BOARD_COPY.lineupSource}</p>
        </div>
        <div className="hub-wcc-week-stepper">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => {
              const current = Number(weekValue || weekPlaceholder) || 1;
              onWeekChange?.({ target: { value: String(Math.max(1, current - 1)) } });
            }}
          >
            ‹
          </button>
          <output aria-live="polite">Week {Number(weekValue || weekPlaceholder) || 1}</output>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => {
              const current = Number(weekValue || weekPlaceholder) || 1;
              onWeekChange?.({ target: { value: String(Math.min(22, current + 1)) } });
            }}
          >
            ›
          </button>
        </div>
      </header>

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

      <div className="hub-wcc-board-stage">
        <div className="hub-wcc-board-grid" id="hub-wcc-calls">
          {hideSlots ? null : slots.map((slot) => {
            const pid = slot.player?.player_id;
            return (
              <SlotCard
                key={slot.key}
                slot={slot}
                decision={decisionForStarter(slot, decisions)}
                wide={pid ? wideById.get(String(pid)) : null}
                movement={pid ? moveById.get(String(pid)) : null}
                canEdit={canEdit}
                selected={Boolean(canEdit && selectedBenchId && pid)}
                onSelect={onSelectSlot}
                onApplyDecision={onApplyDecision}
                onFillSlot={!pid && onNavigate ? () => onNavigate("available", { pos: slot.position || String(slot.slot || "").replace(/\d+$/, "") }) : undefined}
              />
            );
          })}
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

      {!emptyRoster && bench.length > 0 ? (
        <div className="hub-wcc-bench">
          <h4>Bench</h4>
          <ul className="hub-wcc-bench-list">
            {bench.filter((player) => player?.player_id).map((player) => (
              <BenchChip
                key={player.player_id}
                player={player}
                highlighted={swapBenchIds.has(String(player.player_id))}
                selected={String(selectedBenchId) === String(player.player_id)}
                canEdit={canEdit}
                onSelect={onSelectBench}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
