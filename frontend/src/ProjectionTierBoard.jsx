import React, {useMemo} from 'react';
import PlayerCell from './PlayerCell';
import useMobileLayout from './useMobileLayout';
import {usePageWindowedRows} from './DraftHub/useWindowedRows';
import {HubLoadingSkeleton} from './DraftHub/HubUILayout';
import {BOARD_COPY, projectionNumber, projectionTierCopy} from './projectionsPresentation';
import {groupProjectionRows, projectionTierLayout, projectionTierWindow} from './projectionTiers';
import './styles/projection-tier-board.css';

/** The same complete tier list drives the desktop table and compact phone rows. */
export default function ProjectionTierBoard({rows=[], getTierValue, getStatus, getView, columns,
  tierBasis, sort, onSort, toolbarAction, onOpen, onSelect, selecting=false, selectedIds=new Set(), maxSelected=4,
  media, loading=false, emptyMessage, onClearFilters, numberDigits=1}) {
  const mobile=useMobileLayout();
  const groups=useMemo(()=>groupProjectionRows(rows,getTierValue,getStatus),[rows,getTierValue,getStatus]);
  const layout=useMemo(()=>projectionTierLayout(groups,mobile?88:80),[groups,mobile]);
  // Reuse the page-scroll hook in pixels, then binary-search variable header/row offsets.
  const windowed=rows.length>40;
  const {rootRef,range}=usePageWindowedRows(layout.height,{rowHeight:1,overscan:768,enabled:windowed});
  const window=windowed?projectionTierWindow(layout,range.start,range.end):{entries:layout.entries,top:0,bottom:0};
  const count=columns.length+2;
  const head=group=>{
    const copy=projectionTierCopy(group.id);
    return <div className="projection-tier-heading" data-tier={group.id}>
      <span className="projection-tier-mark" aria-hidden="true">{copy.mark}</span>
      <h3>{copy.title}</h3><span className="projection-tier-band">{copy.band}</span>
      <span className="projection-tier-count">{BOARD_COPY.playerCount(group.rows.length)}</span>
    </div>;
  };
  const player=(entry)=>{
    const row=entry.row, view=getView(row), id=String(row.player_id||'');
    const selected=selectedIds.has(id);
    const canSelect=selecting && id && !view.blocked && (selectedIds.size<maxSelected||selected);
    const action=()=>{if(selecting){if(canSelect)onSelect?.(row);}else onOpen?.(row);};
    const name=<div className="projection-tier-identity">
      <PlayerCell name={row.Player} team={row.Team} playerId={id} media={media} size="md" showTeam={false}
        clickable={Boolean(id&&onOpen)} onPlayerClick={()=>onOpen?.(row)}/>
      {view.badge&&<span className="projection-tier-badge">{view.badge}</span>}
      <span className="projection-tier-player-meta">{view.meta}</span>
    </div>;
    const rank=<span className="projection-tier-rank">{view.rank??'—'}<small>{view.movement||'\u00a0'}</small></span>;
    const primary=columns.at(-1);
    const primaryLabel=view.blocked||projectionNumber(view.values[primary.key],numberDigits);
    const primaryButton=<button type="button" className="projection-tier-primary"
      onClick={event=>{event.stopPropagation();action();}}
      disabled={!id||(selecting&&!canSelect)} aria-pressed={selecting?selected:undefined}
      aria-label={selecting?BOARD_COPY.selectPlayer(row.Player):BOARD_COPY.openPlayer(row.Player)}>
      <strong>{primaryLabel}</strong>
      {mobile&&!selecting&&view.sub&&<small>{view.sub}</small>}
    </button>;
    const className=`projection-tier-player${selected?' is-selected':''}${view.blocked?' is-unavailable':''}`;
    if(mobile)return <div className={className} key={entry.key} data-player-id={id} role="listitem" onClick={action}>
      {rank}{name}{primaryButton}
    </div>;
    return <tr className={className} key={entry.key} data-player-id={id} onClick={action}>
      <td className="num col-rank projection-tier-rank-cell">{rank}</td><td className="projection-tier-name-cell">{name}</td>
      {columns.map((column,index)=><td key={column.key} className={`${column.text?'':'num '}projection-tier-cell${index===columns.length-1?' is-primary':''}${column.text?' is-text':''}`}>
        {index===columns.length-1?primaryButton:column.text?(view.values[column.key]||'—'):projectionNumber(view.blocked&&column.forecast?null:view.values[column.key],column.digits??numberDigits)}
      </td>)}
    </tr>;
  };
  if(loading&&!rows.length)return <HubLoadingSkeleton label={BOARD_COPY.loadingBoard} rows={7}/>;
  if(!rows.length)return <div className="projection-tier-empty"><p>{emptyMessage||BOARD_COPY.emptyBoard}</p>
    {onClearFilters&&<button type="button" className="btn-ghost" onClick={onClearFilters}>{BOARD_COPY.resetFilters}</button>}</div>;
  return <div className="projection-tier-board">
    <div className="projection-tier-key"><span>{tierBasis}</span>{toolbarAction||<span>{BOARD_COPY.tierSort}</span>}</div>
    {mobile?<div ref={rootRef} className="projection-tier-list" role="list" aria-label={BOARD_COPY.rankedPlayers}>
      {window.top>0&&<div aria-hidden="true" style={{height:window.top}}/>}
      {window.entries.map(entry=>entry.kind==='tier'?<div className="projection-tier-mobile-heading" key={entry.key}>{head(entry.group)}</div>:player(entry))}
      {window.bottom>0&&<div aria-hidden="true" style={{height:window.bottom}}/>}
    </div>:<table className="projection-tier-table" aria-label={BOARD_COPY.rankedPlayers}>
      <thead><tr><th className="num col-rank projection-tier-rank-cell">{BOARD_COPY.rank}</th>
        <th className="projection-tier-name-cell" aria-sort={sort.column==='Player'?sort.dir==='asc'?'ascending':'descending':'none'}>
          <button type="button" onClick={()=>onSort('Player')}>{BOARD_COPY.player}</button></th>
        {columns.map(column=><th key={column.key} className={`${column.text?'':'num '}projection-tier-cell${column.text?' is-text':''}`}
          aria-sort={sort.column===column.sortKey?sort.dir==='asc'?'ascending':'descending':'none'}>
          <button type="button" onClick={()=>onSort(column.sortKey)} title={column.tip}>{column.label}
            {sort.column===column.sortKey&&<span aria-hidden="true">{sort.dir==='asc'?' ↑':' ↓'}</span>}</button></th>)}
      </tr></thead>
      <tbody ref={rootRef}>
        {window.top>0&&<tr className="projection-tier-spacer" aria-hidden="true"><td colSpan={count} style={{height:window.top}}/></tr>}
        {window.entries.map(entry=>entry.kind==='tier'?<tr className="projection-tier-header-row" key={entry.key}><td colSpan={count}>{head(entry.group)}</td></tr>:player(entry))}
        {window.bottom>0&&<tr className="projection-tier-spacer" aria-hidden="true"><td colSpan={count} style={{height:window.bottom}}/></tr>}
      </tbody>
    </table>}
  </div>;
}
