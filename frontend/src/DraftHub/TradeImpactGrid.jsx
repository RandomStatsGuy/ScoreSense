import { pointDelta, pointTone } from './tradeOutlook';
import { TRADE_DISCOVERY_COPY as C } from './leagueTradesPresentation';
function Meter({value,label,caption,scale}){
 const tone=pointTone(value);
 return <div className={`ss-trade-metric ss-trade-meter ${tone}`}><h3>{label}</h3><strong>{pointDelta(value)} <small>pts</small></strong><div className="ss-trade-meter-track" role="img" aria-label={`${label}: ${value==null?'unavailable':pointDelta(value)+' projected points'}`}><span className="ss-trade-meter-fill" style={{'--fill':`${Math.min(Math.abs(value||0)/scale,1)*50}%`}}/></div><p>{caption}</p></div>;
}
export default function TradeImpactGrid({impact,salaryLeague}) {
 const v=impact;
 return <section className="ss-trade-impact" aria-label={C.impact} aria-live="polite"><header><h2>{C.impact}</h2><span>{C.basis}</span></header><div className="ss-trade-impact-grid">
  <Meter value={v.season} label={C.season} caption={C.remaining} scale={320}/>
  {salaryLeague&&<Meter value={v.contract} label={C.contract} caption={C.contractMethod} scale={640}/>}
  <div className="ss-trade-metric"><h3>{C.lineup}</h3>{[['starters',C.starters],['bench',C.bench]].map(([key,label])=><div className="ss-trade-depth-row" key={key}><span>{label}</span><strong className={pointTone(v[key])}>{pointDelta(v[key])} <small>pts</small></strong></div>)}<p>Bench {v.benchBefore??'—'} → {v.benchAfter??'—'} players</p></div>
  {salaryLeague&&<div className={`ss-trade-metric ${pointTone(v.efficiency)}`}><h3>{C.efficiency}</h3><strong>{pointDelta(v.efficiency)}</strong><p>Send {v.sentRate?.toFixed(1)??'—'} → Get {v.getRate?.toFixed(1)??'—'}</p></div>}
 </div></section>;
}
