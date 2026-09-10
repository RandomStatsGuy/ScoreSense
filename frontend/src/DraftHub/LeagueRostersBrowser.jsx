import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import ContractHistoryLink from "./ContractHistoryLink";
import { seedTradeFromPlayer, seedTradePartner } from "./tradeSeed";
import { downloadLeagueWorkbook } from "./leagueWorkbook";
import { ROSTERS_COPY, ROSTER_BOARD_COPY as C, rosterBoardRows, rosterRowKey, rosterMoney, rosterDifference, rosterDifferenceLabel, rosterContractLabel, ownerLine, nicknameLine, tradeLockReason, expireChipLabel } from "./leagueRostersPresentation";
import "../styles/league-rosters.css";

// Local filter control for the approved board: searchable team list, native buttons,
// dismissal/focus behavior, and no changes to the shared menus on other pages.
function BoardFilter({
  label,
  value,
  options,
  onChange,
  searchable = false
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef(null);
  const trigger = useRef(null);
  const search = useRef(null);
  useEffect(() => {
    if (!open) return;
    if (searchable) search.current?.focus();
    const outside = e => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, searchable]);
  const shown = options.filter(o => `${o.label} ${o.detail || ""}`.toLowerCase().includes(query.toLowerCase()));
  const selected = options.find(o => o.id === value);
  return <div className="rosters-filter" ref={root} onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }} onKeyDown={e => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="rosters-control" aria-label={`${label}: ${selected?.label || ""}`} aria-expanded={open} onClick={() => {
      setQuery("");
      setOpen(!open);
    }}>{selected?.label}<span aria-hidden="true">⌄</span></button>
    {open && <div className="rosters-filter-menu" aria-label={label}>
      {searchable && <input ref={search} aria-label={C.teamSearch} placeholder={C.teamSearch} value={query} onChange={e => setQuery(e.target.value)} />}
      <div className="rosters-filter-options">{shown.map(o => <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => {
          onChange(o.id);
          setOpen(false);
          trigger.current?.focus();
        }}><span>{o.label}</span>{o.detail && <small>{o.detail}</small>}</button>)}</div>
    </div>}
  </div>;
}
function Difference({
  row
}) {
  const delta = rosterDifference(row);
  return <span className={`rosters-difference ${delta == null || delta === 0 ? "" : delta < 0 ? "is-below" : "is-above"}`}>{delta != null && delta !== 0 && <i aria-hidden="true" />}{rosterDifferenceLabel(row)}</span>;
}
export default function LeagueRostersBrowser({
  leagueId,
  hubContext,
  onNavigateTrade,
  onOpenContractHistory
}) {
  const mobileLayout = useMobileLayout();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState("deals");
  const [teamId, setTeamId] = useState("");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("");
  const [value, setValue] = useState("all");
  const [sort, setSort] = useState("difference");
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState(null);
  const [closed, setClosed] = useState(false);
  const request = useRef(0);
  const rowButtons = useRef(new Map());
  const detailHeading = useRef(null);
  const currentLeague = useRef(leagueId);
  currentLeague.current = leagueId;
  const load = useCallback(async (refresh = false) => {
    const id = ++request.current;
    if (!leagueId) {
      setOverview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/rosters${refresh ? "?refresh=1" : ""}`);
      if (!response.ok) throw new Error(await parseApiError(response));
      const data = await response.json();
      if (id === request.current && currentLeague.current === leagueId) setOverview(data);
    } catch (e) {
      if (id === request.current && currentLeague.current === leagueId) setError(connectionErrorMessage(e));
    } finally {
      if (id === request.current && currentLeague.current === leagueId) setLoading(false);
    }
  }, [leagueId]);
  useEffect(() => {
    setOverview(null);
    setTeamId("");
    setQuery("");
    setPosition("");
    setValue("all");
    setPage(0);
    setSelectedKey(null);
    setClosed(false);
    setExportError("");
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  const blocks = useMemo(() => [...(overview?.teams || [])].filter(b => b?.team?.id).sort((a, b) => ownerLine(a.team).localeCompare(ownerLine(b.team))), [overview]);
  const rows = useMemo(() => rosterBoardRows(blocks, {
    view,
    teamId,
    query,
    position,
    value,
    sort
  }), [blocks, view, teamId, query, position, value, sort]);
  const scopeRows = useMemo(() => rosterBoardRows(blocks, {
    view,
    teamId,
    query,
    position
  }), [blocks, view, teamId, query, position]);
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * 8, currentPage * 8 + 8);
  const selected = closed ? null : visible.find(r => rosterRowKey(r) === selectedKey) || visible[0] || null;
  const ids = useMemo(() => visible.map(r => r.player_id).filter(Boolean), [visible.map(rosterRowKey).join("|")]);
  const media = usePlayerMedia(ids);
  const myTeamId = hubContext?.team_id;
  const block = blocks.find(b => b.team?.id === teamId);
  const lockReason = selected ? tradeLockReason(selected, hubContext?.acquisition_window) : "";
  const disabledReason = !onNavigateTrade ? C.readonly : !selected?.player_id ? C.noId : lockReason;
  const change = (setter, next) => {
    setter(next);
    setPage(0);
    setSelectedKey(null);
    setClosed(false);
  };
  const reset = () => {
    setTeamId("");
    setQuery("");
    setPosition("");
    setValue("all");
    setPage(0);
    setClosed(false);
  };
  const select = row => {
    setSelectedKey(rosterRowKey(row));
    setClosed(false);
    requestAnimationFrame(() => detailHeading.current?.focus({
      preventScroll: !mobileLayout
    }));
  };
  const close = () => {
    const key = selected && rosterRowKey(selected);
    setClosed(true);
    rowButtons.current.get(key)?.focus({
      preventScroll: true
    });
  };
  const exportWorkbook = async () => {
    if (!leagueId || exporting) return;
    const exportingLeague = leagueId;
    setExporting(true);
    setExportError("");
    try {
      await downloadLeagueWorkbook(leagueId);
    } catch (e) {
      if (currentLeague.current === exportingLeague) setExportError(connectionErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  const teams = [{
    id: "",
    label: C.allTeams
  }, ...blocks.map(b => ({
    id: b.team.id,
    label: ownerLine(b.team),
    detail: nicknameLine(b.team)
  }))];
  const positions = [{
    id: "",
    label: C.positions
  }, ...[...new Set(blocks.flatMap(b => (b.roster || []).filter(Boolean).map(r => r.position).filter(Boolean)))].sort().map(id => ({
    id,
    label: id
  }))];
  const detail = selected && <aside className="rosters-detail" aria-label={`${selected.player_name} contract`} onKeyDown={e => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }}>
    <button className="rosters-close" aria-label={C.close} onClick={close}>×</button>
    <h2 ref={detailHeading} tabIndex={-1}><PlayerCell name={selected.player_name} playerId={selected.player_id} team={selected.team} position={selected.position} media={media} size="lg" /></h2>
    <p className="rosters-managed">{C.managedBy} <strong>{ownerLine(selected.ownerTeam)}{selected.ownerTeamId === myTeamId ? ` · ${ROSTERS_COPY.you}` : ""}</strong></p>
    <div className="rosters-detail-values"><dl><div><dt>{C.salary}</dt><dd>{rosterMoney(selected.salary)}</dd></div><div><dt>{C.estimate}</dt><dd>{rosterMoney(selected.fair_value)}</dd></div></dl><Difference row={selected} /></div>
    <div className="rosters-detail-contract"><span>{C.contract}</span><strong>{rosterContractLabel(selected)}</strong>{expireChipLabel(selected.expire_chip) && <span>{expireChipLabel(selected.expire_chip)}</span>}</div>
    <button className="rosters-primary" disabled={Boolean(disabledReason)} aria-describedby={disabledReason ? "rosters-trade-reason" : undefined} onClick={() => {
      if (disabledReason) return;
      seedTradeFromPlayer({
        player_id: selected.player_id,
        player_name: selected.player_name,
        team_id: selected.ownerTeamId,
        salary: selected.salary,
        position: selected.position
      });
      onNavigateTrade();
    }}>{selected.ownerTeamId === myTeamId ? ROSTERS_COPY.addToTrade : ROSTERS_COPY.proposeTrade}</button>
    {disabledReason && <p id="rosters-trade-reason" className="rosters-help">{disabledReason}</p>}
    <ContractHistoryLink playerId={selected.player_id} playerName={selected.player_name} onOpen={onOpenContractHistory} className="rosters-history">{C.history}</ContractHistoryLink>
  </aside>;
  return <section className="rosters-board" aria-labelledby="rosters-heading">
    <header className="rosters-header"><div><h1 id="rosters-heading">{ROSTERS_COPY.heading}</h1><p>{ROSTERS_COPY.support}</p></div><div className="rosters-header-actions"><button className="rosters-control" disabled={!leagueId || loading} onClick={() => load(true)} aria-label={ROSTERS_COPY.refreshLeague}><span aria-hidden="true">↻</span>{loading && overview ? C.refreshing : C.refresh}</button><button className="rosters-control" disabled={!leagueId || exporting} onClick={exportWorkbook}><span aria-hidden="true">↓</span>{exporting ? ROSTERS_COPY.exportBusy : ROSTERS_COPY.exportExcel}</button></div></header>
    {(error || exportError) && <p className="rosters-error" role="alert">{error || exportError}</p>}
    {!leagueId ? <p className="rosters-empty">{C.noLeague}</p> : <>
    <div className="rosters-tabbar"><div className="rosters-tabs" role="tablist" aria-label={ROSTERS_COPY.heading}>{C.tabs.map(tab => <button key={tab.id} id={`rosters-tab-${tab.id}`} role="tab" aria-selected={view === tab.id} aria-controls="rosters-results" tabIndex={view === tab.id ? 0 : -1} onKeyDown={e => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
              e.preventDefault();
              const next = e.key === "Home" ? "deals" : e.key === "End" ? "teams" : view === "deals" ? "teams" : "deals";
              change(setView, next);
              document.getElementById(`rosters-tab-${next}`)?.focus();
            }
          }} onClick={() => change(setView, tab.id)}>{tab.label}</button>)}</div>{overview && <div className="rosters-counts"><span>{C.resultCount(scopeRows.length)}</span><span className="is-below">{C.below(scopeRows.filter(r => rosterDifference(r) < 0).length)}</span><span className="is-above">{C.above(scopeRows.filter(r => rosterDifference(r) > 0).length)}</span></div>}</div>
    <div className="rosters-toolbar"><BoardFilter label={C.manager} value={teamId} options={teams} onChange={v => change(setTeamId, v)} searchable /><label className="rosters-search"><span aria-hidden="true">⌕</span><input aria-label={C.search} placeholder={C.search} value={query} onChange={e => change(setQuery, e.target.value)} /></label><BoardFilter label="Position" value={position} options={positions} onChange={v => change(setPosition, v)} /><div className="rosters-segments" role="radiogroup" aria-label={C.difference}>{C.filters.map(f => <button key={f.id} role="radio" aria-checked={value === f.id} tabIndex={value === f.id ? 0 : -1} onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const index = C.filters.findIndex(item => item.id === value); const next = e.key === "Home" ? 0 : e.key === "End" ? 2 : (index + (e.key === "ArrowRight" ? 1 : 2)) % 3; change(setValue, C.filters[next].id); e.currentTarget.parentElement.children[next]?.focus(); } }} onClick={() => change(setValue, f.id)}>{f.label}</button>)}</div><div className="rosters-sort"><BoardFilter label="Sort by" value={sort} options={C.sorts} onChange={v => change(setSort, v)} /></div></div>
    <p className="rosters-explanation">{C.explanation}</p>
    {view === "teams" && block && <div className="rosters-team-summary"><strong>{ownerLine(block.team)}</strong><span>{nicknameLine(block.team)}</span><span>{C.capRoom}: {rosterMoney(block.stats?.unspent)}</span><span>{C.deadCap}: {rosterMoney(block.stats?.dead_cap)}</span>{onNavigateTrade && teamId !== myTeamId && <button className="rosters-control" onClick={() => {
          seedTradePartner(teamId);
          onNavigateTrade();
        }}>{ROSTERS_COPY.proposeTrade}</button>}</div>}
    <div id="rosters-results" role="tabpanel" aria-labelledby={`rosters-tab-${view}`} aria-busy={loading}>
    {loading && !overview ? <div className="rosters-skeleton" role="status" aria-label={ROSTERS_COPY.loading}>{Array.from({
            length: 8
          }, (_, i) => <div key={i}><span /><span /><span /></div>)}</div> : overview && <div className={`rosters-content${selected ? " has-selection" : ""}`}><div className="rosters-table-card"><table className="rosters-table"><caption className="rosters-sr">{C.tabs.find(t => t.id === view).label}</caption><thead><tr><th scope="col">{C.player}</th><th scope="col" className="rosters-manager-col">{C.manager}</th><th scope="col" className="rosters-num">{C.salary}</th><th scope="col" className="rosters-num rosters-estimate-col">{C.estimate}</th><th scope="col" className="rosters-num">{C.difference}</th><th scope="col" className="rosters-contract-col">{C.contract}</th><th scope="col" className="rosters-chevron"><span className="rosters-sr">{C.select}</span></th></tr></thead><tbody>{visible.map(row => <React.Fragment key={rosterRowKey(row)}><tr className={selected && rosterRowKey(selected) === rosterRowKey(row) ? "is-selected" : ""} onClick={() => select(row)}><td><button className="rosters-player" ref={el => {
                        if (el) rowButtons.current.set(rosterRowKey(row), el);else rowButtons.current.delete(rosterRowKey(row));
                      }} aria-label={C.selectPlayer(row.player_name)} aria-expanded={Boolean(selected && rosterRowKey(selected) === rosterRowKey(row))} onClick={e => {
                        e.stopPropagation();
                        select(row);
                      }}><PlayerCell name={row.player_name} playerId={row.player_id} team={row.team} position={row.position} media={media} size="md" /></button></td><td className="rosters-manager-col">{ownerLine(row.ownerTeam)}</td><td className="rosters-num">{rosterMoney(row.salary)}</td><td className="rosters-num rosters-estimate-col">{rosterMoney(row.fair_value)}</td><td className="rosters-num"><Difference row={row} /></td><td className="rosters-contract-col">{rosterContractLabel(row)}</td><td className="rosters-chevron" aria-hidden="true">›</td></tr>{mobileLayout && selected && rosterRowKey(selected) === rosterRowKey(row) && <tr className="rosters-inline-detail"><td colSpan={7}>{detail}</td></tr>}</React.Fragment>)}</tbody></table>{!rows.length && <div className="rosters-empty"><p>{C.noResults}</p><button className="rosters-control" onClick={reset}>{C.reset}</button></div>}<footer className="rosters-pagination"><span role="status">{C.pagination(rows.length ? currentPage * 8 + 1 : 0, Math.min(rows.length, currentPage * 8 + 8), rows.length)}</span><div><button disabled={currentPage === 0} aria-label="Previous page" onClick={() => {
                  setPage(currentPage - 1);
                  setClosed(false);
                }}>‹</button><span>{currentPage + 1} / {pages}</span><button disabled={currentPage >= pages - 1} aria-label="Next page" onClick={() => {
                  setPage(currentPage + 1);
                  setClosed(false);
                }}>›</button></div></footer></div>{!mobileLayout && detail}</div>}
    </div></>}
  </section>;
}
