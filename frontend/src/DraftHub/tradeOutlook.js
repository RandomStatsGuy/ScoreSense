import { buildStarterSlotPlan, slotAcceptsPosition } from './weekBoard.js';
import { normalizeHubPosition } from './hubPositions.js';
import { partyTradeBundle } from './tradeWeekPreview.js';

const num = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const points = (row, forecasts) => num(forecasts?.[row.player_id]?.remaining_points);
const sum = values => values.some(v => v == null) ? null : values.reduce((a,b)=>a+b,0);
export const pointDelta = value => value == null ? '—' : `${value >= .05 ? '+' : ''}${Math.abs(value)<.05?'0.0':value.toFixed(1)}`;
export const pointTone = value => value == null || Math.abs(value)<.05 ? 'even' : value>0?'gain':'loss';

// Maximum eligible lineup via dynamic programming; honors each league's custom FLEX positions.
export function splitProjectedRoster(rows, rules, forecasts) {
  const roster=rows.filter(r=>String(r.roster_status||'active')==='active');
  const slots=buildStarterSlotPlan(rules);
  if (!slots.length || slots.length>14) return null;
  let states=new Map([[0,{value:0,ids:[]}]]);
  const missing=roster.filter(r=>points(r,forecasts)==null);
  const uncertain=new Set(missing.map(r=>normalizeHubPosition(r.position)));
  // Missing FLEX competitors can change each other's starter/bench assignment.
  for(const slot of slots) {
    const eligible=['QB','RB','WR','TE','K','DEF'].filter(pos=>slotAcceptsPosition(slot,pos,rules));
    if(eligible.some(pos=>uncertain.has(pos)))eligible.forEach(pos=>uncertain.add(pos));
  }
  for (const row of roster.filter(r=>points(r,forecasts)!=null)) {
    const next=new Map(states);
    for (const [mask,best] of states) for(let i=0;i<slots.length;i++) {
      if ((mask&(1<<i)) || !slotAcceptsPosition(slots[i],normalizeHubPosition(row.position),rules)) continue;
      const key=mask|(1<<i),value=best.value+points(row,forecasts);
      if(!next.has(key)||value>next.get(key).value)next.set(key,{value,ids:[...best.ids,row.player_id]});
    }
    states=next;
  }
  const best=[...states.values()].sort((a,b)=>b.value-a.value || b.ids.length-a.ids.length)[0];
  const starters=roster.filter(r=>best.ids.includes(r.player_id));
  // Place unknown players in remaining eligible slots for roster counts only, never as zero points.
  const occupied=new Set();
  const assign=(rows)=>rows.forEach(row=>{const index=slots.findIndex((slot,i)=>!occupied.has(i)&&slotAcceptsPosition(slot,normalizeHubPosition(row.position),rules));if(index>=0)occupied.add(index);});
  assign(starters);
  for(const row of missing){const index=slots.findIndex((slot,i)=>!occupied.has(i)&&slotAcceptsPosition(slot,normalizeHubPosition(row.position),rules));if(index>=0){occupied.add(index);starters.push(row);}}
  const starterIds=new Set(starters.map(r=>r.player_id)),bench=roster.filter(r=>!starterIds.has(r.player_id));
  return {starters,bench,uncertain,missing,starterPoints:best.value,benchPoints:bench.reduce((total,row)=>total+(points(row,forecasts)||0),0)};
}
export function positionStrengthRanks(rosterByTeam,rules,forecasts) {
  const splits=Object.fromEntries(Object.entries(rosterByTeam).map(([id,rows])=>[id,splitProjectedRoster(rows,rules,forecasts)]));
  const result={};
  for(const [id,split] of Object.entries(splits)) {
    result[id]={};
    for(const pos of ['QB','RB','WR','TE','K','DEF']) {
      result[id][pos]={};
      for(const section of ['starters','bench']) {
        const score=s=>s==null||s.uncertain.has(pos)?null:sum(s[section].filter(r=>normalizeHubPosition(r.position)===pos).map(r=>points(r,forecasts)));
        const values=Object.values(splits).map(score),own=score(split);
        // Partial data cannot create a falsely strong league rank. Ties share rank.
        result[id][pos][section]=!split?.[section].some(r=>normalizeHubPosition(r.position)===pos)||own==null||values.some(v=>v==null)?null:1+values.filter(v=>v>own+.001).length;
      }
    }
  }
  return result;
}
export function projectedTradeImpact({rosterByTeam,parties,myTeamId,rules,forecasts,salaryLeague}) {
  const before=rosterByTeam[myTeamId]||[],bundle=partyTradeBundle(parties,myTeamId);
  const all=Object.values(rosterByTeam).flat();
  const outgoing=before.filter(r=>bundle.sendIds.has(r.player_id));
  const removed=before.filter(r=>bundle.sendIds.has(r.player_id)||bundle.dropIds.has(r.player_id));
  const incoming=bundle.receiveIds.map(id=>all.find(r=>r.player_id===id)).filter(Boolean);
  const after=[...before.filter(r=>!removed.includes(r)),...incoming];
  const difference=(a,b)=>a==null||b==null?null:a-b;
  const season=difference(sum(incoming.map(r=>points(r,forecasts))),sum(removed.map(r=>points(r,forecasts))));
  const life=r=>{const remaining=points(r,forecasts),annual=num(forecasts?.[r.player_id]?.annual_points),term=num(r.years_remaining??r.contract?.years_remaining??r.contract_years);return remaining==null||term==null||(term>1&&annual==null)?null:remaining+(Math.max(1,term)-1)*(annual||0);};
  const first=splitProjectedRoster(before,rules,forecasts),last=splitProjectedRoster(after,rules,forecasts);
  const efficiency=rows=>{const total=sum(rows.map(r=>points(r,forecasts))),salary=sum(rows.map(r=>num(r.salary)));return total==null||salary==null||salary<=0?null:total/salary;};
  const sentRate=efficiency(outgoing),getRate=efficiency(incoming);
  const changedPositions=new Set([...removed,...incoming].map(r=>normalizeHubPosition(r.position)));
  const splitKnown=first&&last&&![...changedPositions].some(pos=>first.uncertain.has(pos)||last.uncertain.has(pos));
  return {season,contract:salaryLeague?difference(sum(incoming.map(life)),sum(removed.map(life))):null,starters:splitKnown?difference(last.starterPoints,first.starterPoints):null,bench:splitKnown?difference(last.benchPoints,first.benchPoints):null,benchBefore:first?.bench.length,benchAfter:last?.bench.length,sentRate,getRate,efficiency:difference(getRate,sentRate)};
}
export function currentTradeCap(rows,stats,cap) {
  const salaries=sum(rows.filter(r=>String(r.roster_status||'active')==='active').map(r=>num(r.salary)));
  return salaries==null||num(cap)==null?null:Number(cap)-salaries-Number(stats?.dead_cap||0);
}
