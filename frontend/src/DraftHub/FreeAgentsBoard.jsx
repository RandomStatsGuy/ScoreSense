import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HubFilterMenu, HubPage } from "./HubUILayout";
import HubMediaImg from "./HubMediaImg";
import { headshotCandidates, playerInitials } from "./draftMedia";
import useModalFocus from "../ui/useModalFocus";
import { resolveSeasonBand, seasonRangeTooltip } from "../seasonQuantiles";
import { effectiveAuctionBid } from "../riskAdjustedValue";
import { suggestedBidSubLabel } from "./suggestedBidLabel";
import { scoringLabel } from "./strategyRank";
import { parseWalkaway, bidBlockedByCeiling } from "./faWalkaway";
import { FA_BID_COPY, faWalkawayAbove } from "./faBidPresentation";
import { CLAIM_QUEUE_COPY, PLAYERS_TAB_COPY as COPY, playersTabAddLabel, playersTabBusyLabel } from "./acquisitionWindow";
import "./FreeAgentsBoard.css";

const pts = (n, digits = 0) => n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(digits);
export const FREE_AGENT_ROW_HEIGHT = 100;

function Icon({ search = false }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {search ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></> : <><circle cx="12" cy="12" r="9" /><path d="M12 10v7M12 7v1" /></>}
  </svg>;
}

function Face({ row, media }) {
  const src = headshotCandidates(media?.[row.player_id], [], { width: 96 })[0];
  return <span className="fa-face" aria-hidden="true"><span>{playerInitials(row.player)}</span><HubMediaImg src={src} width={96} /></span>;
}

function Range({ band, scale }) {
  if (![band.p10, band.p50, band.p90].every(n => n != null && Number.isFinite(n))) return null;
  const pct = n => `${Math.max(0, Math.min(100, n / scale * 100))}%`;
  return <div className="fa-range-track" aria-hidden="true" style={{ "--low": pct(band.p10), "--median": pct(band.p50), "--high": pct(band.p90) }} />;
}

function ActionSheet({ draft, media, scale, mode, canAct, busy, error, onClose, onChange, onConfirm,
  remainingCap, pickDraft, rules, riskTolerance, roster, priority, onHistory, onWatch, watched, reason }) {
  const ref = useRef(null);
  const [drop, setDrop] = useState("");
  useModalFocus(true, ref, () => { if (!busy) onClose(); });
  const row = draft.row, band = resolveSeasonBand(row);
  const bid = parseWalkaway(draft.amount), ceiling = parseWalkaway(draft.ceiling);
  const aboveCeiling = bidBlockedByCeiling(bid, ceiling);
  const aboveCap = !pickDraft && remainingCap != null && bid != null && bid > Number(remainingCap);
  const blocked = !canAct || busy || (mode === "bid" && (bid == null || ceiling == null || aboveCeiling || aboveCap));
  const suggested = effectiveAuctionBid(row, riskTolerance, rules);
  const pricing = suggestedBidSubLabel({ scoringProfile: rules?.scoring_profile || rules?.scoring, riskTolerance });
  return createPortal(<div className="fa-sheet-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="fa-sheet-name" tabIndex={-1} className="fa-sheet">
      <header className="fa-dialog-head"><h2>{COPY.playerDetails}</h2><button className="fa-icon" aria-label={COPY.close} onClick={onClose} disabled={busy}>×</button></header>
      <div className="fa-dialog-content">
        <div className="fa-dialog-identity"><Face row={row} media={media} /><div><h3 id="fa-sheet-name">{row.player}</h3><p>{[row.position, row.team].filter(Boolean).join(" · ")}</p></div></div>
        <div className="fa-detail-chart">
          <dl className="fa-detail-stats">{[[COPY.floor, band.p10], [COPY.seasonShort, band.p50], [COPY.ceiling, band.p90]].map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{pts(n)}</dd></div>)}</dl>
          <Range band={band} scale={scale} />
          <p className="fa-muted">{row.per_game_proj != null ? `${pts(row.per_game_proj, 1)} ${COPY.perGame} · ` : ""}{scoringLabel(rules?.scoring_profile || rules?.scoring)}</p>
          <p className="fa-muted">{seasonRangeTooltip(band.method, { preliminary: band.preliminary })}</p>
        </div>
        {!pickDraft && suggested != null && <p><strong>{COPY.suggested(suggested)}</strong><span className="fa-support">{pricing}</span></p>}
        {mode === "bid" && <>
          <div className="fa-bid-fields"><label className="fa-field">{COPY.yourBid}<input type="number" min="1" step="1" inputMode="numeric" value={draft.amount} disabled={busy} onChange={e => onChange({ amount: e.target.value })} /></label>
            <label className="fa-field">{FA_BID_COPY.walkAway}<input type="number" min="1" step="1" inputMode="numeric" value={draft.ceiling} disabled={busy} onChange={e => onChange({ ceiling: e.target.value })} /></label></div>
          <p className="fa-muted">{COPY.ceilingHint}</p>
          {!pickDraft && remainingCap != null && bid != null && <p>{COPY.capAfter(Number(remainingCap) - bid)}</p>}
          {aboveCeiling && <p className="fa-warning" role="status">{COPY.aboveCeiling}</p>}
          {aboveCap && <p className="fa-warning" role="status">{COPY.aboveCap}</p>}
        </>}
        {mode === "claim" && <><p className="fa-muted">{priority}</p><HubFilterMenu className="hub-filter-menu--fluid hub-filter-menu--inline" label={CLAIM_QUEUE_COPY.dropLabel} value={drop} options={[{ id: "", label: CLAIM_QUEUE_COPY.noDrop }, ...roster.map(p => ({ id: String(p.player_id), label: p.player_name || p.player || String(p.player_id) }))]} disabled={busy || !canAct} onChange={setDrop} /></>}
        {mode === "add" && <p className="fa-muted">{pickDraft ? COPY.addEffect : COPY.addSalaryEffect(suggested)}</p>}
        {reason && <p className="fa-warning">{reason}</p>}
        {!pickDraft && onHistory && <button className="fa-quiet-link" disabled={busy} onClick={() => { onClose(); onHistory({ playerId: row.player_id, playerName: row.player }); }}>{COPY.history}<span aria-hidden="true">↗</span></button>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      <footer className="fa-dialog-footer">
        {mode === "locked" && onWatch && <button className="btn-ghost btn-sm" disabled={busy} aria-pressed={watched} onClick={() => onWatch(row)}>{watched ? COPY.starredShort : COPY.starShort}</button>}
        <button className="btn-primary fa-confirm" disabled={blocked} onClick={() => onConfirm(drop)}>{busy ? playersTabBusyLabel(mode) : mode === "bid" ? FA_BID_COPY.placeBid : mode === "claim" ? COPY.confirmClaim : COPY.addPlayer}</button>
      </footer>
    </section>
  </div>, document.body);
}

export default function FreeAgentsBoard({ rows, count, loading, media, scale, scrollerRef, topPad, bottomPad, loadMore,
  pickDraft, rules, riskTolerance, banner, acquisitionWindow, remainingCap, addMode, addVisible, addEnabled, actionsDisabled,
  claims, priority, protectedIds, roster, rosterIds, onWatch, watchIds, onHistory, claimContent, ceilingFor,
  posFilter, positionOptions, setPosFilter, sortKey, sortOptions, onSort, search, setSearch,
  tierFilter, tierOptions, setTierFilter, riskProfile, riskOptions, setRiskProfile, needsOnly, needPositions, setNeedsOnly,
  boardDirty, resetBoard, emptyMessage, draft, onOpen, onClose, onChange, onConfirm, busy, error }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const watched = id => watchIds.some(value => String(value) === String(id));
  const claimed = id => claims.some(c => String(c.player_id) === String(id));
  const protectedPlayer = id => protectedIds.some(value => String(value) === String(id));
  const inRoster = id => rosterIds?.has(id) || rosterIds?.has(String(id));
  const reasonFor = row => addMode === "locked" ? (acquisitionWindow?.message || COPY.lockedReason) : protectedPlayer(row.player_id) ? CLAIM_QUEUE_COPY.protected : claimed(row.player_id) ? COPY.claimInQueue : inRoster(row.player_id) ? COPY.onRoster : actionsDisabled || !addVisible ? COPY.readOnly : "";
  const canAct = row => addEnabled && !actionsDisabled && !protectedPlayer(row.player_id) && !claimed(row.player_id) && !inRoster(row.player_id);
  const pricing = pickDraft ? scoringLabel(rules?.scoring_profile || rules?.scoring) : suggestedBidSubLabel({ scoringProfile: rules?.scoring_profile || rules?.scoring, riskTolerance });
  const title = addMode === "locked" ? COPY.lockedReason : banner?.label || COPY.openAdds;
  return <HubPage frameless className="fa-main">
    <h1 className="sr-only">{COPY.title}</h1>
    <div className="fa-window"><div className="fa-window-copy"><strong>{title}</strong><span>{addMode === "claim" ? priority : !pickDraft && remainingCap != null ? COPY.capAvailable(remainingCap) : addMode === "locked" ? COPY.starHint : COPY.seasonOutlook}</span></div>
      <button className="fa-icon" aria-label={COPY.howAddsWork} aria-expanded={infoOpen} aria-controls="fa-how-adds" onClick={() => setInfoOpen(v => !v)}><Icon /></button></div>
    {infoOpen && <div className="fa-info" id="fa-how-adds"><p>{banner?.text || COPY.howAddsBody}</p>{banner?.text && <p>{COPY.howAddsBody}</p>}</div>}
    {addMode === "claim" && <>{!priority || priority === CLAIM_QUEUE_COPY.needsConfirm ? claimContent : <details className="fa-claims-disclosure"><summary>{COPY.claimCount(claims.length)} · {priority}</summary>{claimContent}</details>}</>}
    <div className="fa-toolbar"><HubFilterMenu className="hub-filter-menu--fluid" label={COPY.pos} value={posFilter} options={positionOptions} onChange={setPosFilter} />
      <HubFilterMenu className="hub-filter-menu--fluid" label={COPY.sort} value={sortKey} options={sortOptions.map(option => ({ ...option, shortLabel: COPY.sortShort[option.id] }))} onChange={onSort} />
      <button className="fa-icon" aria-label={COPY.searchFilters} aria-expanded={filtersOpen} aria-controls="fa-filters" onClick={() => setFiltersOpen(v => !v)}><Icon search /></button></div>
    {filtersOpen && <div className="fa-filters" id="fa-filters"><input type="search" aria-label={COPY.search} placeholder={COPY.search} value={search} onChange={e => setSearch(e.target.value)} />
      {!pickDraft && <HubFilterMenu label={COPY.tier} value={tierFilter} options={tierOptions} onChange={setTierFilter} />}
      <HubFilterMenu label={COPY.risk} value={riskProfile} options={riskOptions} onChange={setRiskProfile} />
      {needPositions.length > 0 && <button className="btn-ghost btn-sm" aria-pressed={needsOnly} onClick={() => setNeedsOnly(v => !v)}>{COPY.needs(needPositions)}</button>}
      <button className="btn-ghost btn-sm" disabled={!boardDirty} onClick={resetBoard}>{COPY.reset}</button></div>}
    <div className="fa-list-label"><p aria-live="polite">{COPY.count(count)}</p><p>{COPY.seasonOutlook} · {pricing}</p></div>
    {error && !draft && <p className="fa-info" role="status">{error}</p>}
    <div className="fa-pool" ref={scrollerRef} aria-busy={loading}>
      {loading && count === 0 ? <div role="status" aria-label={COPY.loading}>{[0, 1, 2, 3, 4].map(n => <div className="fa-skeleton" key={n} />)}</div> : null}
      {!loading && count === 0 && <div className="fa-empty"><p>{emptyMessage}</p>{boardDirty && <button className="btn-ghost btn-sm" onClick={resetBoard}>{COPY.reset}</button>}</div>}
      {topPad > 0 && <div aria-hidden="true" style={{ height: topPad }} />}
      {rows.map(row => {
        const band = resolveSeasonBand(row), suggested = effectiveAuctionBid(row, riskTolerance, rules);
        return <article className={`fa-player${addMode === "locked" ? " is-locked" : ""}`} key={row.player_id} data-player-id={row.player_id}>
          <div className="fa-player-top"><button className="fa-profile" onClick={() => onOpen(row)} aria-label={COPY.openDetails(row.player)}><Face row={row} media={media} /><span className="fa-name"><strong>{row.player}</strong><span>{[row.position, row.team].filter(Boolean).join(" · ")}</span>{row.per_game_proj != null && <span>{pts(row.per_game_proj, 1)} {COPY.perGame}</span>}</span></button>
            <div className="fa-outlook"><strong>{pts(band.p50)}</strong><small>{COPY.seasonShort}</small></div></div>
          <div className="fa-player-bottom"><div className="fa-range" title={seasonRangeTooltip(band.method, { preliminary: band.preliminary })}><div className="fa-range-copy"><span>{pts(band.p10)}–{pts(band.p90)} {COPY.range}</span>{!pickDraft && suggested != null && <strong className={addMode === "bid" && bidBlockedByCeiling(suggested, ceilingFor?.(row.player_id)) ? "fa-warning" : undefined} title={addMode === "bid" && bidBlockedByCeiling(suggested, ceilingFor?.(row.player_id)) ? faWalkawayAbove(ceilingFor(row.player_id)) : undefined}>{COPY.suggested(suggested)}</strong>}</div><Range band={band} scale={scale} /></div>
            {addMode === "locked" && onWatch && <button className="fa-icon" aria-label={`${watched(row.player_id) ? COPY.unstar : COPY.star}: ${row.player}`} aria-pressed={watched(row.player_id)} onClick={() => onWatch(row)}>{watched(row.player_id) ? "★" : "☆"}</button>}
            {addVisible && <button className="fa-acquire" disabled={!canAct(row) || busy} title={reasonFor(row)} aria-label={`${playersTabAddLabel(addMode)} ${row.player}`} onClick={() => onOpen(row)}>{claimed(row.player_id) ? CLAIM_QUEUE_COPY.claimed : playersTabAddLabel(addMode)}</button>}</div>
        </article>;
      })}
      {bottomPad > 0 && <div aria-hidden="true" style={{ height: bottomPad }} />}
    </div>
    {loadMore && <button className="btn-ghost btn-sm" onClick={loadMore}>{COPY.more}</button>}
    {draft && <ActionSheet key={draft.row.player_id} draft={draft} media={media} scale={scale} mode={addMode} canAct={canAct(draft.row)} busy={busy} error={error} onClose={onClose} onChange={onChange} onConfirm={onConfirm} remainingCap={remainingCap} pickDraft={pickDraft} rules={rules} riskTolerance={riskTolerance} roster={roster} priority={priority} onHistory={onHistory} onWatch={onWatch} watched={watched(draft.row.player_id)} reason={reasonFor(draft.row)} />}
  </HubPage>;
}
