import React, { useEffect, useId, useRef, useState } from "react";
import useFantasyReady from "../useFantasyReady";
import { MY_TEAM_COPY as COPY, roomNumber, roomDelta } from "./rosterPresentation";
import { roomProjectionTotal, roomPreviewLineup, roomPreviewScope, canPreviewRoomSwap } from "./teamRoomPresentation";
import { JerseySvg } from "./LockerRoomScene";
import { nflTeamColors } from "./nflTeamColors";
import { paintMediaUrl, PAINT_WIDTH, teamLogoUrl } from "./draftMedia";
import { HubFilterMenu } from "./HubUILayout";
import { formatSyncedAgo } from "./gameCenterPresentation";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import MatchupBannerArt from "./MatchupBannerArt";

// A short, undisclosed interaction. CSS animates one jersey; React does no frame work.
function RoomLocker({ player: p, media = {}, chosen, top, index, columns, id, state, onOpen, onDrop, canDrop }) {
  const timer = useRef(null), pointer = useRef(null), held = useRef(false), button = useRef(null);
  const colors = nflTeamColors(p.team), delta = roomDelta(p, state);
  const cancel = () => { clearTimeout(timer.current); timer.current = null; };
  useEffect(() => cancel, []);
  const swing = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = button.current?.querySelector(".hub-locker-jersey");
    if (!el) return;
    el.classList.remove("is-swinging");
    void el.getBoundingClientRect();
    el.classList.add("is-swinging");
    el.addEventListener("animationend", () => el.classList.remove("is-swinging"), { once: true });
  };
  return <div className={`team-room-locker${chosen ? " is-open" : ""}${top ? " is-top" : ""}${canDrop ? " is-drop-ready" : ""}`}
    style={{ "--locker-offset": `${Math.abs(index - (columns - 1) / 2) * 5}px` }}
    onDragOver={(e) => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
    onDrop={(e) => { e.preventDefault(); if (canDrop) onDrop(); }}>
    <button ref={button} type="button" className="team-room-locker-trigger" disabled={!p.player_id}
      data-room-player={p.player_id} aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
      aria-expanded={chosen} aria-controls={`${id}-detail`} aria-label={`Open ${p.name}'s locker`}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        cancel(); held.current = false; pointer.current = [e.clientX, e.clientY];
        timer.current = setTimeout(() => { held.current = true; swing(); }, 450);
      }}
      onPointerMove={(e) => { if (pointer.current && Math.hypot(e.clientX - pointer.current[0], e.clientY - pointer.current[1]) > 9) cancel(); }}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onKeyDown={(e) => { if (e.shiftKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); swing(); } }}
      onClick={(e) => { if (held.current && e.detail !== 0) { held.current = false; return; } onOpen(p.player_id, e.currentTarget); }}>
      <span className="team-room-player-score">
        <strong>{state === "pregame" ? p.slot || p.position : roomNumber(p.points)}</strong>
        {state !== "pregame" && <small>{COPY.roomRecorded}</small>}
        {top && <small className="team-room-award">Top scorer</small>}
      </span>
      <span className="team-room-cubicle">
        <JerseySvg detailed colors={colors.jersey} number={media.jersey_number} gradientId={`${id}-jersey-${index}`} />
        <span className="team-room-player-name"><b>{p.name}</b>
          {p.nickname && <span className="team-room-nameplate-nickname">“{p.nickname}”</span>}
          <small>{p.position} · {p.team || "FA"}</small>
        </span>
        <img className="team-room-team-mark" src={paintMediaUrl(media.team_logo_url, PAINT_WIDTH.mark) || teamLogoUrl(p.team, { width: 48 })}
          alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
      </span>
      <span className="team-room-player-projection"><strong>{roomNumber(p.projection)}</strong><small>{COPY.roomProjectionLabel}</small>
        {delta != null && <small className={delta >= 0 ? "positive" : ""}>{delta > 0 ? "+" : ""}{delta.toFixed(1)} vs proj</small>}
      </span>
    </button>
  </div>;
}

export default function TeamRoomView({ data, onWeek, onTeam, onContract, onNickname, onShare, onAppearance, onLineup, matchupHref, busy = false, message = "" }) {
  useFantasyReady("roster", "team-room", Boolean(data));
  const { identities } = useTeamIdentities();
  const [section, setSection] = useState("starters"), [selected, setSelected] = useState(null);
  const [nickname, setNickname] = useState(""), [sharing, setSharing] = useState(false);
  const [preview, setPreview] = useState({}), [candidate, setCandidate] = useState(null), [dragging, setDragging] = useState(null), [notice, setNotice] = useState("");
  const id = useId().replaceAll(":", ""), trigger = useRef(null), detailRef = useRef(null), roomRef = useRef(null);
  const scope = roomPreviewScope(data);
  const swaps = preview.scope === scope ? preview.swaps : {};
  const lineup = roomPreviewLineup(data, swaps);
  const hasStarters = data.starters.some((p) => p.player_id);
  const players = section === "starters" && hasStarters ? lineup.starters : lineup.bench;
  const active = players.find((p) => p.player_id === selected);
  const slotIndex = section === "starters" ? lineup.starters.findIndex((p) => p.player_id === selected) : -1;
  const eligible = slotIndex < 0 ? [] : lineup.bench.filter((p) => p.preview_slots?.includes(slotIndex));
  const incoming = eligible.find((p) => p.player_id === candidate);
  const total = roomProjectionTotal(lineup.starters), originalTotal = roomProjectionTotal(data.starters);
  const change = total == null || originalTotal == null ? null : total - originalTotal;
  const swapChange = incoming?.projection == null || active?.projection == null ? null : Number(incoming.projection) - Number(active.projection);
  const canSwap = !busy && canPreviewRoomSwap(data, active, incoming, slotIndex);
  useEffect(() => {
    setSelected(null); setSection("starters"); setSharing(false); setPreview({}); setCandidate(null); setDragging(null); setNotice("");
  }, [scope]);
  useEffect(() => {
    if (Object.keys(swaps).length > lineup.count) { setPreview({}); setSelected(null); setCandidate(null); }
  }, [scope, lineup.count, preview]);
  useEffect(() => { setNickname(active?.nickname || ""); }, [active?.player_id, active?.nickname]);
  useEffect(() => {
    if (selected && window.matchMedia("(max-width: 768px)").matches) detailRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selected]);
  const close = () => {
    const target = trigger.current?.isConnected ? trigger.current : [...(roomRef.current?.querySelectorAll("[data-room-player]") || [])].find((el) => el.dataset.roomPlayer === selected);
    setSelected(null); setCandidate(null); target?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!selected && !sharing) return;
    const escape = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); setSharing(false); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selected, sharing]);
  const open = (pid, element) => { trigger.current = element; setSelected(selected === pid ? null : pid); setCandidate(null); };
  const applyPreview = (benchId, index) => {
    const incomingPlayer = lineup.bench.find((p) => p.player_id === benchId), outgoing = lineup.starters[index];
    if (!canPreviewRoomSwap(data, outgoing, incomingPlayer, index) || busy) return;
    setPreview({ scope, swaps: { ...swaps, [index]: benchId } });
    setSelected(benchId); setCandidate(null); setDragging(null); setNotice(COPY.roomPreviewUpdated(incomingPlayer.name, outgoing.name));
  };
  const compareBench = (p) => {
    let index = slotIndex;
    if (index < 0 || !canPreviewRoomSwap(data, lineup.starters[index], p, index)) index = lineup.starters.findIndex((starter, i) => canPreviewRoomSwap(data, starter, p, i));
    if (index < 0) { setNotice(p.projection == null ? COPY.roomCompareMissing : COPY.roomNoPreviewSlot); return; }
    setSection("starters"); setSelected(lineup.starters[index].player_id); setCandidate(p.player_id);
  };
  const winner = data.state === "final" && players.some((p) => p.points != null) ? Math.max(...players.filter((p) => p.points != null).map((p) => Number(p.points))) : null;
  const shareUrl = data.share_token ? `${location.origin}/team-room/${data.share_token}` : "";
  const switchSection = (value) => { setSection(value); setSelected(null); setCandidate(null); };
  return <section ref={roomRef} className={`team-room team-room--${data.theme || "none"}`} aria-label={`${data.team.name} team room`}>
    <MatchupBannerArt identity={identityFor(identities, data.team)} variant="room" />
    <div className="team-room-orbits" aria-hidden="true"><i /><i /><i /></div>
    <header className="team-room-heading"><div className="team-room-crest" aria-hidden="true">
      {data.photo_url ? <img src={data.photo_url} alt="" /> : (data.team.name || "Team").split(/\s+/).map((s) => s[0]).slice(0, 2).join("")}
    </div><div><h1>{data.team.name}</h1>{data.team.owner_name && <p>{data.team.owner_name}</p>}</div>
      <div className="team-room-actions">
        {data.teams?.length > 1 && <HubFilterMenu label="Visit team" value={data.team.id} options={data.teams.map((t) => ({ id: t.id, label: [t.owner_name, t.name].filter(Boolean).join(" · ") }))} onChange={onTeam} />}
        {data.can_edit && onAppearance && <button onClick={onAppearance} className="btn-ghost">Edit look</button>}
        {data.can_edit && <button className="btn-ghost" aria-expanded={sharing} onClick={() => { setSharing(!sharing); setSelected(null); setCandidate(null); }}>{COPY.shareRoom}</button>}
      </div>
    </header>
    {sharing && <div className="team-room-share"><p>{COPY.shareDescription}</p>{shareUrl ? <><label>Room link<input readOnly value={shareUrl} onFocus={(e) => e.target.select()} /></label><button className="btn-ghost" disabled={busy} onClick={() => onShare(false)}>Turn off sharing</button></> : <button className="btn-primary" disabled={busy} onClick={() => onShare(true)}>Create share link</button>}</div>}
    <div className="team-room-toolbar">
      <HubFilterMenu label="Week" value={String(data.week)} options={Array.from({ length: data.max_week || 18 }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }))} onChange={(v) => onWeek(Number(v))} />
      <div role="group" aria-label="Room roster"><button aria-pressed={section === "starters"} onClick={() => switchSection("starters")}>Starters <span>{lineup.starters.length}</span></button><button aria-pressed={section === "bench"} onClick={() => switchSection("bench")}>Bench <span>{lineup.bench.length}</span></button></div>
      <span className="team-room-freshness">{formatSyncedAgo(data.synced_at)}</span>
      {matchupHref && <a className="team-room-matchup-link" href={matchupHref}>{COPY.openGameCenter} <span aria-hidden="true">→</span></a>}
    </div>
    {hasStarters && <div className="team-room-lineup-total"><div><span>{lineup.count ? COPY.roomPreviewProjection : COPY.roomProjection}</span><div className="team-room-total-number"><strong>{roomNumber(total)}</strong><small>pts</small>{lineup.count > 0 && change != null && <span className={change > 0 ? "positive" : ""}>{change > 0 ? "+" : ""}{roomNumber(change)} · {COPY.roomVsCurrent}</span>}</div></div>
      <div className="team-room-total-context"><p>{total == null ? COPY.roomMissingTotal : lineup.count ? COPY.roomPreviewOnly : data.can_edit ? data.lineup_host === "sleeper" ? COPY.roomSleeperPreview : COPY.roomNativePreview : COPY.roomStates[data.state]}</p>{lineup.count > 0 && <button className="btn-ghost" onClick={() => { setPreview({}); setSelected(null); setCandidate(null); setNotice(COPY.roomPreviewReset); }}>{COPY.roomResetPreview}</button>}</div>
    </div>}
    {!hasStarters && section === "starters" && data.bench.length > 0 && <div className="team-room-empty"><p>{COPY.lineupEmpty}</p>{onLineup && <button className="btn-link" onClick={onLineup}>{COPY.manageLineup}</button>}</div>}
    {!players.length ? <p className="team-room-empty">{COPY.roomEmpty}</p> : <div className="team-room-wall" style={{ "--room-columns": Math.min(12, players.length), "--room-detail-row-phone": Math.floor(players.findIndex((p) => p.player_id === selected) / 2) + 2, "--room-detail-row-medium": Math.floor(players.findIndex((p) => p.player_id === selected) / 3) + 2 }}>
      {players.map((p, i) => <RoomLocker key={`${p.player_id}-${i}`} player={p} media={data.media?.[p.player_id]} index={i} columns={players.length} id={id} chosen={selected === p.player_id} top={winner != null && p.points === winner && winner > 0} state={data.state} onOpen={open}
        canDrop={section === "starters" && canPreviewRoomSwap(data, p, lineup.bench.find((b) => b.player_id === dragging), i)} onDrop={() => applyPreview(dragging, i)} />)}
      {active && <section ref={detailRef} className="team-room-drawer" id={`${id}-detail`} aria-label={`${active.name} locker details`}>
        <header className="team-room-drawer-head"><div>{active.nickname && <span className="team-room-detail-kicker">{COPY.roomYourNickname}</span>}<h2>{active.nickname ? `“${active.nickname}”` : active.name}</h2><p>{[active.nickname && active.name, active.position, active.team, active.slot !== active.position && active.slot].filter(Boolean).join(" · ")}</p></div><button className="btn-ghost" onClick={close} aria-label="Close locker">×</button></header>
        <div className="team-room-detail-grid"><div><span className="team-room-detail-label">{COPY.roomPregameProjection}</span><div className="team-room-detail-score"><strong>{roomNumber(active.projection)}</strong><small>pts</small></div>
          <p>{active.projection == null ? active.projection_status === "not_saved" ? COPY.projectionNotSaved : COPY.projectionMissing : `${COPY.roomRecorded}: ${roomNumber(active.points)} · ${COPY.roomStates[data.state]}`}</p>
          {roomDelta(active, data.state) != null && <p className={roomDelta(active, data.state) >= 0 ? "positive" : ""}>{roomDelta(active, data.state) > 0 ? "+" : ""}{roomNumber(roomDelta(active, data.state))} vs projection</p>}
          {data.can_edit && active.can_manage !== false && onNickname && <details key={active.player_id} className="team-room-nickname-edit"><summary>Edit nickname</summary><form onSubmit={(e) => { e.preventDefault(); onNickname(active.player_id, nickname); }}><label>{COPY.nicknameLabel}<input maxLength={40} value={nickname} onChange={(e) => setNickname(e.target.value)} /></label><div className="team-room-drawer-actions"><button className="btn-ghost" disabled={busy}>Save nickname</button><button type="button" className="btn-link" disabled={busy} onClick={() => onNickname(active.player_id, null)}>{COPY.resetNickname}</button></div></form></details>}
        </div><div><dl className="team-room-detail-facts"><div><dt>{COPY.roomPosition}</dt><dd>{active.position} · {active.team}</dd></div><div><dt>{COPY.roomSlot}</dt><dd>{active.slot || COPY.roomBenchHeading}</dd></div></dl>
          <p>{active.kickoff_available === false ? COPY.roomKickoffMissing : active.lineup_locked ? COPY.roomLocked : active.lineup_locked === false ? COPY.roomNotStarted : COPY.roomStates[data.state]}</p>
          <div className="team-room-detail-links">{data.can_edit && active.can_manage !== false && onContract && <button className="btn-link" onClick={(e) => onContract(active.player_id, e.currentTarget)}>View contract</button>}
          {data.can_edit && onLineup && <button className="btn-link" onClick={onLineup}>{COPY.manageLineup} →</button>}</div>
        </div>{data.can_edit && slotIndex >= 0 && <div className="team-room-swap-panel"><h3>{COPY.roomBenchCompare}</h3>
          {eligible.length ? eligible.map((p) => <button className="btn-ghost team-room-bench-pick" key={p.player_id} aria-pressed={candidate === p.player_id} onClick={() => setCandidate(p.player_id)}><span>{p.name}</span><b>{roomNumber(p.projection)}</b></button>) : <p>{COPY.roomNoBenchOption}</p>}
          {incoming && <><div className="team-room-swap-action">{swapChange != null && <strong className={swapChange > 0 ? "positive" : ""}>{swapChange > 0 ? "+" : ""}{roomNumber(swapChange)} <small>pts</small></strong>}<button className="btn-primary" disabled={!canSwap} onClick={() => applyPreview(incoming.player_id, slotIndex)}>{COPY.roomPreviewSwap}</button></div><p>{incoming.projection == null ? COPY.roomCompareMissing : data.lineup_host === "sleeper" ? COPY.roomSleeperPreview : COPY.roomNativePreview}</p></>}
        </div>}</div>
      </section>}
    </div>}
    {section === "starters" && hasStarters && lineup.bench.length > 0 && <section className="team-room-bench-section"><div className="team-room-bench-heading"><h2>{COPY.roomBenchHeading} · {lineup.bench.length}</h2>{data.can_edit && <span>{COPY.roomBenchHint}</span>}</div><div className="team-room-bench-players">
      {lineup.bench.map((p, i) => { const colors = nflTeamColors(p.team), usable = data.can_edit && lineup.starters.some((s, j) => canPreviewRoomSwap(data, s, p, j)); return <button type="button" className="team-room-bench-player" key={p.player_id} draggable={usable} aria-pressed={candidate === p.player_id} aria-label={COPY.roomDragPlayer(p.name)}
        onDragStart={(e) => { if (!usable) { e.preventDefault(); return; } setDragging(p.player_id); e.dataTransfer.setData("text/plain", p.player_id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDragging(null)}
        onClick={(e) => { trigger.current = e.currentTarget; if (data.can_edit) compareBench(p); else { setSection("bench"); setSelected(p.player_id); } }}>
        <JerseySvg detailed colors={colors.jersey} number={data.media?.[p.player_id]?.jersey_number} gradientId={`${id}-bench-${i}`} /><span className="team-room-bench-identity"><b>{p.name}</b><small>{p.position} · {p.team}</small>{p.nickname && <small>“{p.nickname}”</small>}{p.lineup_locked && <small>{p.kickoff_available === false ? COPY.roomKickoffMissing : COPY.roomLocked}</small>}</span><span className="team-room-bench-projection"><strong>{roomNumber(p.projection)}</strong><small>{COPY.roomProjectionLabel}</small></span>
      </button>; })}
    </div></section>}
    <p className="team-room-status" role="status" aria-live="polite">{message || notice}</p>
    <div className="team-room-floor" aria-hidden="true"><span className="team-room-bench" /><span className="team-room-floor-mark">{(data.team.name || "").split(/\s+/).map((s) => s[0]).slice(0, 2).join("")}</span></div>
  </section>;
}
