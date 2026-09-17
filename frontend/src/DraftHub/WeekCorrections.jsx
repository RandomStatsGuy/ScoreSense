import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { HubFilterMenu, HubPage } from "./HubUILayout";
import { CORRECTIONS_COPY as COPY, correctionTeamRows, correctionSlots, correctionSlotRows, assignCorrectionPlayer, correctionChanges, currentCorrectionCandidates } from "./weekCorrectionsPresentation";
import "./WeekCorrections.css";
import { clearHubDataCache } from "./hubDataCache";

export default function WeekCorrections({ leagueId, season, onChanged }) {
  const [selectedTeam, setSelectedTeam] = useState("");
  const [targetSlot, setTargetSlot] = useState("BN");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchRef = useRef(null);
  const [week, setWeek] = useState(1);
  const [context, setContext] = useState(null);
  const [teams, setTeams] = useState([]);
  const [reason, setReason] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const scope = useRef(0);
  const resultRef = useRef(null);
  const base = `/api/hub/league/${encodeURIComponent(leagueId)}/corrections/${season}/${week}`;
  useEffect(() => {
    const generation = ++scope.current;
    setQuery(""); setSuggestions([]); setTargetSlot("BN"); setContext(null); setPreview(null); setTeams([]); setError(""); setReason(""); setAcknowledge(false); setBusy(false);
    const controller = new AbortController();
    (async () => {
      try {
        const response = await apiFetch(base, { signal: controller.signal });
        if (!response.ok) throw new Error(await parseApiError(response));
        const data = await response.json();
        if (scope.current !== generation) return;
        setContext(data); setTeams(correctionTeamRows(data)); setSelectedTeam(previous => data.teams.some(team => team.id === previous) ? previous : data.teams[0]?.id || "");
      } catch (failure) {
        if (scope.current === generation && failure.name !== "AbortError") setError(failure.message);
      }
    })();
    return () => { scope.current += 1; controller.abort(); };
  }, [base, reload]);

  const edit = (teamIndex, playerIndex, field, value) => {
    setPreview(null);
    setTeams(previous => previous.map((team, index) => index !== teamIndex ? team : {
      ...team, players: team.players.map((player, row) => row !== playerIndex ? player : { ...player, [field]: value }),
    }));
  };
  const request = async (publish = false) => {
    const generation = scope.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = publish ? {
        preview_id: preview.id, revision: preview.revision, reason: preview.reason, idempotency_key: preview.id,
      } : { teams, reason, revision: context.revision, acknowledge_empty: acknowledge };
      const response = await apiFetch(`${base}/${publish ? "publish" : "preview"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await parseApiError(response));
      const data = await response.json();
      if (scope.current !== generation) return;
      if (publish) {
        clearHubDataCache();
        setNotice(COPY.published); setPreview(null); setReload(value => value + 1); onChanged?.();
      } else {
        setPreview(data);
        requestAnimationFrame(() => resultRef.current?.focus());
      }
    } catch (failure) {
      if (scope.current === generation) setError(failure.message);
    } finally {
      if (scope.current === generation) setBusy(false);
    }
  };
  const slots = correctionSlots(context?.slots);
  const teamIndex = teams.findIndex(team => team.team_id === selectedTeam);
  const team = teams[teamIndex];
  const metadata = context?.teams.find(item => item.id === selectedTeam);
  const teamLabel = item => item?.owner_name || item?.name || COPY.manager;
  const changes = correctionChanges(correctionTeamRows(context), teams);
  const eligible = (position, slot) => slot === "BN" || (context?.slot_positions?.[slot.replace(/\d+$/, "")] || [slot.replace(/\d+$/, "")]).includes(position);
  const changePlayers = players => { setPreview(null); setTeams(previous => previous.map(item => item.team_id === selectedTeam ? {...item, players} : item)); };
  const fill = slot => { setTargetSlot(slot); setQuery(""); setSuggestions([]); requestAnimationFrame(() => searchRef.current?.focus()); };
  const assign = player => { changePlayers(assignCorrectionPlayer(team.players, player, targetSlot)); setQuery(""); setSuggestions([]); };
  useEffect(() => {
    const controller = new AbortController();
    setSuggestions([]); setSearchError(""); setSearching(false);
    if (query.trim().length < 2) return () => controller.abort();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({name: query.trim(), season: String(season)});
        const response = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/player-name-aliases/suggest?${params}`, {signal: controller.signal});
        if (!response.ok) throw new Error(await parseApiError(response));
        const data = await response.json();
        if (!controller.signal.aborted) setSuggestions((data.suggestions || []).map(row => ({
          player_id: String(row.sleeper_player_id || row.player_id || ""), player_name: row.player_name,
          position: row.position === "DST" ? "DEF" : row.position, nfl_team: row.nfl_team || row.team || "",
        })).filter(row => row.player_id));
      } catch (failure) { if (!controller.signal.aborted) setSearchError(failure.message); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, leagueId, season, week, selectedTeam]);
  const currentCandidates = currentCorrectionCandidates(context, team);
  const historicalOwner = player => teams.find(item => item.team_id !== selectedTeam && item.players.some(other => other.player_id.replace(/^sleeper-/, "") === player.player_id.replace(/^sleeper-/, "")));
  const candidates = [...(team?.players || []), ...currentCandidates.map(player => ({...player, slot:"BN"})), ...suggestions].filter((player, index, all) =>
    all.findIndex(other => other.player_id === player.player_id) === index && eligible(player.position, targetSlot) &&
    `${player.player_name} ${player.nfl_team}`.toLowerCase().includes(query.trim().toLowerCase()));
  const playerRow = (player, slot) => <div className="correction-player-row" key={slot?.id || player.player_id}>
    <span className="correction-slot">{slot?.label || COPY.bench}</span>
    <div className="correction-player"><strong>{player?.player_name || (player ? player.player_id : COPY.emptySlot)}</strong>
      <span>{player ? [player.nfl_team, player.position].filter(Boolean).join(" · ") : COPY.needsPlayer}</span></div>
    {player ? <HubFilterMenu label={COPY.slot} value={player.slot} disabled={busy}
      options={[{id:"BN",label:COPY.bench}, ...slots.filter(item => eligible(player.position, item.id))]}
      onChange={value => changePlayers(assignCorrectionPlayer(team.players, player, value))} /> :
      <button className="btn-ghost btn-sm" disabled={busy} onClick={() => fill(slot.id)}>{COPY.fill} {slot.label}</button>}
  </div>;
  return <HubPage className="week-corrections">
    <h2>{COPY.title}</h2><p>{COPY.support}</p>
    <div className="correction-toolbar"><label>{COPY.week}<input type="number" min="1" max="18" value={week} disabled={busy}
      onChange={event => { setNotice(""); setWeek(Math.max(1, Math.min(18, Number(event.target.value) || 1))); }} /></label>
      {context && <HubFilterMenu label={COPY.manager} value={selectedTeam} disabled={busy}
        options={context.teams.map(item => ({id:item.id,label:teamLabel(item)}))}
        onChange={value => { setSelectedTeam(value); setQuery(""); setTargetSlot("BN"); }} />}</div>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!context && !error && <p role="status">{COPY.loading}</p>}
    {context && <>
      <div className="correction-workspace">
        <section className="correction-card">
          <h3>{teamLabel(metadata)} · {COPY.week} {week}</h3>
          {metadata?.owner_name && metadata.name !== metadata.owner_name && <p>{metadata.name}</p>}
          {!team?.players.length && <p>{COPY.missing}</p>}
          {team && correctionSlotRows(team.players, slots).map(row => playerRow(row.player, row))}
          <details><summary>{COPY.bench} · {team?.players.filter(player => player.slot === "BN").length || 0}{currentCandidates.length > 0 ? ` · ${COPY.currentOptions(currentCandidates.length)}` : ""}</summary>
            {team?.players.filter(player => player.slot === "BN").map(player => playerRow(player))}
            {currentCandidates.length > 0 && <section className="correction-search">
              <h3>{COPY.currentRoster}</h3><p>{COPY.currentRosterHelp}</p>
              {currentCandidates.map(player => <div className="correction-player-row" key={player.player_id}>
                <div className="correction-player"><strong>{player.player_name || player.player_id}</strong><span>{player.position} · {player.nfl_team}{historicalOwner(player) ? ` · ${COPY.assignedElsewhere}` : ""}</span></div>
                <button className="btn-ghost btn-sm" disabled={busy || Boolean(historicalOwner(player))}
                  onClick={() => changePlayers(assignCorrectionPlayer(team.players, player, "BN"))}>{COPY.addToBench(week)}</button>
              </div>)}
            </section>}
          </details>
          <section className="correction-search" aria-label={COPY.add}>
            <h3>{COPY.add}</h3><p>{COPY.searchHelp}</p>
            <HubFilterMenu label={COPY.destination} value={targetSlot} options={[{id:"BN",label:COPY.bench}, ...slots]} disabled={busy} onChange={setTargetSlot} />
            <label>{COPY.search}<input ref={searchRef} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} placeholder={COPY.searchPlaceholder} /></label>
            {searching && <p role="status">{COPY.searching}</p>}
            {searchError && <p role="alert">{searchError}</p>}
            {query.trim().length >= 2 && !searching && !searchError && !candidates.length && <p>{COPY.noMatches}</p>}
            {(query.trim().length >= 2 ? candidates : candidates.filter(player => player.slot === "BN")).slice(0,12).map(player => {
              const owner = teams.find(item => item.team_id !== selectedTeam && item.players.some(other => other.player_id.replace(/^sleeper-/, "") === player.player_id.replace(/^sleeper-/, "")));
              return <div className="correction-player-row" key={player.player_id}><div className="correction-player"><strong>{player.player_name}</strong><span>{player.position} · {player.nfl_team}{currentCandidates.some(row => row.player_id === player.player_id) ? ` · ${COPY.currentRoster}` : ""}{owner ? ` · ${COPY.assignedElsewhere}` : ""}</span></div>
                <button className="btn-ghost btn-sm" disabled={busy || Boolean(owner)} onClick={() => assign(player)}>{COPY.assign}</button></div>;
            })}
          </section>
          <details><summary>{COPY.advanced}</summary>
            {team?.players.map((player, playerIndex) => <div className="correction-advanced-row" key={playerIndex}>
              <label>{COPY.playerName}<input disabled={busy} value={player.player_name} onChange={event => edit(teamIndex, playerIndex, "player_name", event.target.value)} /></label>
              <label>{COPY.playerId}<input disabled={busy} value={player.player_id} onChange={event => edit(teamIndex, playerIndex, "player_id", event.target.value)} /></label>
              <HubFilterMenu label={COPY.position} value={player.position} options={["QB","RB","WR","TE","K","DEF"].map(id => ({id,label:id}))} disabled={busy} onChange={value => edit(teamIndex,playerIndex,"position",value)} />
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => changePlayers(team.players.filter((_,index) => index !== playerIndex))}>{COPY.remove}: {player.player_name}</button>
            </div>)}
            <button className="btn-ghost btn-sm" disabled={busy || !team} onClick={() => changePlayers([...team.players,{player_id:"",player_name:"",nfl_team:"",position:"QB",slot:"BN"}])}>{COPY.manual}</button>
          </details>
        </section>
        <aside className="correction-card">
          <h3>{COPY.review}</h3>
          {changes.length > 0 && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => {setTeams(correctionTeamRows(context));setPreview(null);}}>{COPY.undo}</button>}
          {!changes.length && <p>{COPY.noChanges}</p>}
          {changes.map((change,index) => <p key={index}><strong>{change.name}</strong><br />{teamLabel(context.teams.find(item => item.id === change.team_id))} · {change.before} → {change.after}</p>)}
          <label>{COPY.reason}<textarea value={reason} disabled={busy} onChange={event => { setReason(event.target.value); setPreview(null); }} /></label>
          <label className="correction-ack"><input type="checkbox" checked={acknowledge} disabled={busy} onChange={event => { setAcknowledge(event.target.checked); setPreview(null); }} />{COPY.empty}</label>
          <button type="button" className={preview ? "btn-ghost btn-sm" : "btn-primary btn-sm"} disabled={busy || reason.trim().length < 3} onClick={() => request()}>{COPY.preview}</button>
        </aside>
      </div>
      {preview && <section ref={resultRef} tabIndex={-1} aria-live="polite">
        <h3>Review Week {week}</h3>
        {preview.blockers.map(blocker => <p key={blocker} role="alert">{blocker}</p>)}
        <div className="correction-results"><table><caption>Scores and standings</caption><thead><tr><th>Team</th><th>Score before</th><th>Score after</th><th>Record before</th><th>Record after</th></tr></thead>
          <tbody>{preview.after.standings.map(row => {
            const prior = preview.before.standings.find(item => item.team_id === row.team_id);
            return <tr key={row.team_id}><td>{row.name}</td><td>{preview.before.scores.find(item => item.team_id === row.team_id)?.points ?? "Not recorded"}</td>
              <td>{preview.after.scores.find(item => item.team_id === row.team_id)?.points}</td><td>{prior?.wins}-{prior?.losses}-{prior?.ties}</td><td>{row.wins}-{row.losses}-{row.ties}</td></tr>;
          })}</tbody></table></div>
        <button type="button" className="btn-primary btn-sm" disabled={busy || !preview.can_publish} onClick={() => request(true)}>{COPY.publish}</button>
      </section>}
      <h3>{COPY.history}</h3>
      {(context.history || []).map(item => <div key={item.id}><p>{item.published_at} · {item.reason}</p>
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => {
          setTeams(correctionTeamRows({ ...context, lineups: item.before.lineups }));
          setReason(`Reverse correction: ${item.reason}`); setAcknowledge(false); setPreview(null);
        }}>Review reversal</button></div>)}
    </>}
  </HubPage>;
}
