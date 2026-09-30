import { useTeamIdentities, identityFor } from './TeamIdentityContext';
import IdentityCropMedia from './IdentityCropMedia';
import { identityMediaUrl, mergeTeamIdentity, HUB_MEDIA_HERO_WIDTH, HUB_MEDIA_MARK_WIDTH, initialsFromName } from './atmosphereCatalog';
import { hubTeamParts, hubTeamLabel } from './hubTeamLabel';
import { fmtSal } from './rosterFormat';
import { TRADE_DISCOVERY_COPY as C } from './leagueTradesPresentation';
import { currentTradeCap } from './tradeOutlook';

export default function TradeDiscovery({teams,myTeamId,rosterByTeam,statsByTeam,salaryCap,salaryLeague,ranks,positions,search,onSearch,onChoose}) {
 const {identities}=useTeamIdentities();
 const query=search.trim().toLowerCase();
 const partners=teams.filter(t=>t.id&&t.id!==myTeamId).filter(t=>`${hubTeamLabel(t)} ${(rosterByTeam[t.id]||[]).map(r=>r.player_name).join(' ')}`.toLowerCase().includes(query));
 return <section className="ss-trade-discovery">
  <input type="search" className="search-input" aria-label={C.searchLabel} placeholder={C.search} value={search} onChange={e=>onSearch(e.target.value)}/>
  <p className="ss-trade-rank-caption">{C.ranks} · {teams.length} teams · PPR</p>
  <div className="ss-trade-team-grid">{partners.map(team=>{
   const look=mergeTeamIdentity(identityFor(identities,team)),parts=hubTeamParts(team);
   const cap=currentTradeCap(rosterByTeam[team.id]||[],statsByTeam[team.id],salaryCap);
   return <button type="button" className="ss-trade-team-card" key={team.id} onClick={()=>onChoose(team.id)} aria-label={`Trade with ${hubTeamLabel(team)}`}>
    <span className={`ss-trade-team-banner hub-banner-fill--${look.banner_preset}`}>
     <IdentityCropMedia src={identityMediaUrl(look,'banner',{width:HUB_MEDIA_HERO_WIDTH})} focus={look.banner_focus} width={HUB_MEDIA_HERO_WIDTH} className="ss-trade-banner-img"/>
     <span className="ss-trade-team-identity"><strong>{parts.team||parts.owner||C.missing}</strong>{parts.owner&&<small>{parts.owner}</small>}</span>
     <span className={`ss-trade-team-mark hub-team-photo--${look.photo_preset}`} aria-hidden="true">{identityMediaUrl(look,'photo')?<IdentityCropMedia src={identityMediaUrl(look,'photo',{width:HUB_MEDIA_MARK_WIDTH})} focus={look.photo_focus} width={HUB_MEDIA_MARK_WIDTH}/>:initialsFromName(parts.team||parts.owner)}</span>
    </span>
    <span className="ss-trade-rank-grid"><span className="ss-trade-rank-head"><span>{C.position}</span><span className="num">{C.starters}</span><span className="num">{C.bench}</span></span>{positions.map(pos=><span className="ss-trade-rank-row" key={pos}><strong>{pos}</strong>{['starters','bench'].map(section=>{const rank=ranks?.[team.id]?.[pos]?.[section];return <span key={section} className={rank!=null&&rank<=2?'ss-trade-rank-strong':''} aria-label={`${pos} ${section} rank ${rank??'unavailable'}`}>{rank??C.missing}</span>;})}</span>)}</span>
    <span className="ss-trade-team-footer"><span>{salaryLeague?C.cap:'View roster'}</span><strong>{salaryLeague?fmtSal(cap):'→'}</strong></span>
   </button>;
  })}</div>{!partners.length&&<p role="status" className="chart-note">{C.noMatches}</p>}
 </section>;
}
