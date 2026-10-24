import React, { useEffect, useId, useRef, useState } from "react";
import useFantasyReady from "../useFantasyReady";
import useMobileLayout from "../useMobileLayout";
import { MY_TEAM_COPY as COPY, roomNumber, roomDelta, roomOnBye, roomForecast } from "./rosterPresentation";
import { roomProjectionTotal, roomPreviewLineup, roomPreviewScope, canPreviewRoomSwap, canPlaceRoomPlayer, roomSavesLineup, roomHeldState, roomBenchEdge, roomOpponentGap } from "./teamRoomPresentation";
import { sleeperLineupUrl } from "./weekBoard";
import { JerseySvg } from "./LockerRoomScene";
import { nflTeamColors } from "./nflTeamColors";
import { paintMediaUrl, PAINT_WIDTH, teamLogoUrl } from "./draftMedia";
import { HubFilterMenu } from "./HubUILayout";
import { formatSyncedAgo } from "./gameCenterPresentation";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import MatchupBannerArt from "./MatchupBannerArt";

const signed = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

// A short, undisclosed interaction. CSS animates one jersey; React does no frame work.
// While a bench jersey is held, the plate shows what the move does: the change, Fits, or Locked.
function RoomLocker({ player: p, media = {}, chosen, top, index, columns, id, state, held, onOpen, onDrop, onPlace }) {
  const timer = useRef(null), pointer = useRef(null), heldDown = useRef(false), button = useRef(null);
  const colors = nflTeamColors(p.team), delta = roomDelta(p, state);
  const canDrop = Boolean(held?.fit);
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
  const heldClass = held ? held.fit ? " is-fit is-drop-ready" : held.locked ? " is-shut" : " is-dim" : "";
  return <div className={`team-room-locker${chosen ? " is-open" : ""}${top ? " is-top" : ""}${heldClass}`}
    style={{ "--locker-offset": `${Math.abs(index - (columns - 1) / 2) * 5}px` }}
    onDragOver={(e) => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
    onDrop={(e) => { e.preventDefault(); if (canDrop) onDrop(); }}>
    <button ref={button} type="button" className="team-room-locker-trigger" disabled={!p.player_id}
      data-room-player={p.player_id} aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
      aria-expanded={chosen} aria-controls={`${id}-detail`} aria-label={canDrop && onPlace ? COPY.roomStartOver(held.name, p.slot || p.position, p.name) : `Open ${p.name}'s locker`}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        cancel(); heldDown.current = false; pointer.current = [e.clientX, e.clientY];
        timer.current = setTimeout(() => { heldDown.current = true; swing(); }, 450);
      }}
      onPointerMove={(e) => { if (pointer.current && Math.hypot(e.clientX - pointer.current[0], e.clientY - pointer.current[1]) > 9) cancel(); }}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onKeyDown={(e) => { if (e.shiftKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); swing(); } }}
      onClick={(e) => { if (heldDown.current && e.detail !== 0) { heldDown.current = false; return; } if (canDrop && onPlace) { onPlace(); return; } onOpen(p.player_id, e.currentTarget); }}>
      <span className="team-room-player-score">
        {held?.fit ? <strong className={`team-room-held-plate${held.delta == null ? "" : held.delta >= 0 ? " positive" : " caution"}`}>{held.delta == null ? COPY.roomFits : signed(held.delta)}</strong>
          : held?.locked ? <strong className="team-room-held-plate is-locked">{COPY.roomHeldLocked}</strong>
          : <strong>{state === "pregame" ? p.slot || p.position : roomNumber(p.points)}</strong>}
        {!held && state !== "pregame" && <small>{COPY.roomRecorded}</small>}
        {held?.fit && <small>{p.slot || p.position}</small>}
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
      <span className="team-room-player-projection"><strong>{roomForecast(p)}</strong>{!roomOnBye(p) && <small>{COPY.roomProjectionLabel}</small>}
        {delta != null && <small className={delta >= 0 ? "positive" : ""}>{delta > 0 ? "+" : ""}{delta.toFixed(1)} vs proj</small>}
      </span>
    </button>
  </div>;
}

export default function TeamRoomView({ data, onWeek, onTeam, onContract, onNickname, onShare, onAppearance, onLineup, onSwap, sleeperLeagueId = "", matchupHref, busy = false, message = "" }) {
  useFantasyReady("roster", "team-room", Boolean(data));
  const { identities } = useTeamIdentities();
  const mobile = useMobileLayout();
  const [section, setSection] = useState("starters"), [selected, setSelected] = useState(null);
  const [nickname, setNickname] = useState(""), [sharing, setSharing] = useState(false);
  const [preview, setPreview] = useState({}), [candidate, setCandidate] = useState(null), [dragging, setDragging] = useState(null), [carry, setCarry] = useState(null), [notice, setNotice] = useState("");
  const [lastMove, setLastMove] = useState(null);
  const id = useId().replaceAll(":", ""), trigger = useRef(null), detailRef = useRef(null), roomRef = useRef(null), statusRef = useRef(null);
  const pendingNotice = useRef(""), baseline = useRef({ key: null, total: null });
  const scope = roomPreviewScope(data);
  const saves = roomSavesLineup(data) && Boolean(onSwap);
  const swaps = preview.scope === scope ? preview.swaps : {};
  const lineup = roomPreviewLineup(data, swaps);
  const hasStarters = data.starters.some((p) => p.player_id);
  const players = section === "starters" && hasStarters ? lineup.starters : lineup.bench;
  const active = players.find((p) => p.player_id === selected);
  const slotIndex = section === "starters" ? lineup.starters.findIndex((p) => p.player_id === selected) : -1;
  const eligible = slotIndex < 0 ? [] : lineup.bench.filter((p) => p.preview_slots?.includes(slotIndex));
  const incoming = eligible.find((p) => p.player_id === candidate);
  const total = roomProjectionTotal(lineup.starters), originalTotal = roomProjectionTotal(data.starters);
  const visitKey = `${data.team.id}:${data.season}:${data.week}`;
  if (baseline.current.key !== visitKey) baseline.current = { key: visitKey, total: originalTotal };
  const change = lineup.count
    ? (total == null || originalTotal == null ? null : total - originalTotal)
    : (lastMove?.saved && total != null && baseline.current.total != null ? total - baseline.current.total : null);
  const swapChange = incoming?.projection == null || active?.projection == null ? null : Number(incoming.projection) - Number(active.projection);
  const canSwap = !busy && canPlaceRoomPlayer(data, active, incoming, slotIndex);
  const heldPlayer = lineup.bench.find((p) => p.player_id === (dragging || carry)) || null;
  const gap = data.state === "final" ? null : roomOpponentGap(total, data.opponent);
  const sleeperHref = sleeperLeagueId ? sleeperLineupUrl(sleeperLeagueId) : "";
  useEffect(() => {
    setSelected(null); setSection("starters"); setSharing(false); setPreview({}); setCandidate(null); setDragging(null); setCarry(null);
    setNotice(pendingNotice.current); pendingNotice.current = "";
  }, [scope]);
  useEffect(() => { setLastMove(null); }, [visitKey]);
  useEffect(() => {
    if (Object.keys(swaps).length > lineup.count) { setPreview({}); setSelected(null); setCandidate(null); }
  }, [scope, lineup.count, preview]);
  useEffect(() => { setNickname(active?.nickname || ""); }, [active?.player_id, active?.nickname]);
  useEffect(() => {
    if (selected && window.matchMedia("(max-width: 768px)").matches) detailRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selected]);
  useEffect(() => { if (lastMove) statusRef.current?.focus({ preventScroll: true }); }, [lastMove]);
  const close = () => {
    const target = trigger.current?.isConnected ? trigger.current : [...(roomRef.current?.querySelectorAll("[data-room-player]") || [])].find((el) => el.dataset.roomPlayer === selected);
    setSelected(null); setCandidate(null); target?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!selected && !sharing && !carry) return;
    const escape = (e) => { if (e.key === "Escape") { e.preventDefault(); if (carry) { setCarry(null); return; } close(); setSharing(false); } };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selected, sharing, carry]);
  const open = (pid, element) => { trigger.current = element; setSelected(selected === pid ? null : pid); setCandidate(null); };
  const applyPreview = (benchId, index) => {
    const incomingPlayer = lineup.bench.find((p) => p.player_id === benchId), outgoing = lineup.starters[index];
    if (!canPreviewRoomSwap(data, outgoing, incomingPlayer, index) || busy) return;
    setPreview({ scope, swaps: { ...swaps, [index]: benchId } });
    setLastMove({ saved: false, incomingId: benchId, outgoingId: outgoing.player_id, incomingName: incomingPlayer.name, outgoingName: outgoing.name, slot: outgoing.slot || outgoing.position });
    setSelected(benchId); setCandidate(null); setDragging(null); setCarry(null); setNotice("");
  };
  // Native leagues save the move; Sleeper leagues keep the projection preview.
  const place = async (benchId, index) => {
    const incomingPlayer = lineup.bench.find((p) => p.player_id === benchId), outgoing = lineup.starters[index];
    if (!saves) { applyPreview(benchId, index); return; }
    if (busy || !canPlaceRoomPlayer(data, outgoing, incomingPlayer, index)) { setNotice(COPY.roomMoveBlocked); return; }
    setDragging(null);
    pendingNotice.current = "";
    const ok = await onSwap(outgoing.player_id, benchId);
    if (!ok) return;
    setCarry(null); setSelected(null); setCandidate(null);
    setLastMove({ saved: true, incomingId: benchId, outgoingId: outgoing.player_id, incomingName: incomingPlayer.name, outgoingName: outgoing.name, slot: outgoing.slot || outgoing.position });
  };
  const undo = async () => {
    if (!lastMove || busy) return;
    if (!lastMove.saved) { setPreview({}); setLastMove(null); setSelected(null); setCandidate(null); setNotice(COPY.roomPreviewReset); return; }
    pendingNotice.current = COPY.roomUndone(lastMove.outgoingName, lastMove.slot);
    const ok = await onSwap(lastMove.incomingId, lastMove.outgoingId);
    if (!ok) { pendingNotice.current = ""; return; }
    setLastMove(null);
  };
  const compareBench = (p) => {
    let index = slotIndex;
    if (index < 0 || !canPlaceRoomPlayer(data, lineup.starters[index], p, index)) index = lineup.starters.findIndex((starter, i) => canPlaceRoomPlayer(data, starter, p, i));
    if (index < 0) { setNotice(p.projection == null && !saves ? COPY.roomCompareMissing : COPY.roomNoPreviewSlot); return; }
    setSection("starters"); setSelected(lineup.starters[index].player_id); setCandidate(p.player_id);
  };
  const pickUp = (p) => {
    if (carry === p.player_id) { setCarry(null); setNotice(""); return; }
    setCarry(p.player_id); setSelected(null); setCandidate(null); setNotice(COPY.roomHoldingAnnounce(p.name));
  };
  const winner = data.state === "final" && players.some((p) => p.points != null) ? Math.max(...players.filter((p) => p.points != null).map((p) => Number(p.points))) : null;
  const shareUrl = data.share_token ? `${location.origin}/team-room/${data.share_token}` : "";
  const switchSection = (value) => { setSection(value); setSelected(null); setCandidate(null); setCarry(null); };
  const usableBench = (p) => data.can_edit && lineup.starters.some((s, j) => canPlaceRoomPlayer(data, s, p, j));
  const showRack = mobile && data.can_edit && hasStarters && section === "starters" && lineup.bench.length > 0 && !["final", "unknown"].includes(data.state);
  const status = <p ref={statusRef} tabIndex={-1} className={`team-room-status${lastMove ? lastMove.saved ? " is-saved" : " is-preview" : ""}`} role="status" aria-live="polite">
    {lastMove ? <>
      <span className="team-room-status-kicker">{lastMove.saved ? COPY.roomSavedKicker : COPY.roomPreviewKicker}</span>
      <span className="team-room-status-text">{COPY.roomSaved(lastMove.incomingName, lastMove.slot, lastMove.outgoingName)}{!lastMove.saved && ` ${COPY.roomPreviewOnly}`}</span>
      {!lastMove.saved && sleeperHref && <a className="btn-link" href={sleeperHref} target="_blank" rel="noreferrer">{COPY.roomViewSleeper} ↗</a>}
      <button type="button" className="btn-link" disabled={busy} onClick={undo}>{lastMove.saved ? COPY.roomUndo : COPY.roomResetPreview}</button>
      {message && <span className="team-room-status-text">{message}</span>}
    </> : (message || notice)}
  </p>;
  return <section ref={roomRef} className={`team-room team-room--${data.theme || "none"}${showRack ? " has-rack" : ""}${heldPlayer ? " is-holding" : ""}`} aria-label={`${data.team.name} team room`}>
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
    {hasStarters && <div className="team-room-lineup-total"><div><span>{lineup.count ? COPY.roomPreviewProjection : COPY.roomProjection}</span><div className="team-room-total-number"><strong>{roomNumber(total)}</strong><small>pts</small>{change != null && Math.abs(change) >= 0.05 && <span className={change > 0 ? "positive" : ""}>{signed(change)} · {lineup.count ? COPY.roomVsCurrent : COPY.roomChangeThisVisit}</span>}</div></div>
      {data.opponent?.projection != null && data.state !== "final" && <div className="team-room-stakes"><span>{COPY.roomOpponentProjected(data.opponent.name)}</span><div className="team-room-stakes-row"><b>{roomNumber(data.opponent.projection)}</b><small>pts</small>{gap != null && <span className={gap > 0.05 ? "positive" : gap < -0.05 ? "caution" : ""}>{gap > 0.05 ? COPY.roomLead(gap) : gap < -0.05 ? COPY.roomTrail(-gap) : COPY.roomEven}</span>}</div></div>}
      <div className="team-room-total-context">{total == null && <p>{COPY.roomMissingTotal}</p>}
        <p>{lineup.count ? COPY.roomPreviewOnly : data.can_edit ? saves ? (mobile ? COPY.roomNativeEditPhone : COPY.roomNativeEdit) : data.lineup_host === "sleeper" ? COPY.roomSleeperEdit : COPY.roomNativePreview : COPY.roomStates[data.state]}</p>
        {data.can_edit && data.lineup_host === "sleeper" && sleeperHref && !lastMove && <a className="btn-link" href={sleeperHref} target="_blank" rel="noreferrer">{COPY.roomViewSleeper} ↗</a>}
      </div>
    </div>}
    {hasStarters && !showRack && status}
    {!hasStarters && section === "starters" && data.bench.length > 0 && <div className="team-room-empty"><p>{COPY.lineupEmpty}</p>{onLineup && <button className="btn-link" onClick={onLineup}>{COPY.manageLineup}</button>}</div>}
    {!players.length ? <p className="team-room-empty">{COPY.roomEmpty}</p> : <div className="team-room-wall" style={{ "--room-columns": Math.min(12, players.length), "--room-detail-row-phone": Math.floor(players.findIndex((p) => p.player_id === selected) / 2) + 2, "--room-detail-row-medium": Math.floor(players.findIndex((p) => p.player_id === selected) / 3) + 2 }}>
      {players.map((p, i) => { const held = section === "starters" && heldPlayer ? { ...roomHeldState(data, p, heldPlayer, i), name: heldPlayer.name } : null;
        return <RoomLocker key={`${p.player_id}-${i}`} player={p} media={data.media?.[p.player_id]} index={i} columns={players.length} id={id} chosen={selected === p.player_id} top={winner != null && p.points === winner && winner > 0} state={data.state} onOpen={open}
          held={held} onDrop={() => place(heldPlayer.player_id, i)} onPlace={carry ? () => place(carry, i) : null} />; })}
      {active && <section ref={detailRef} className="team-room-drawer" id={`${id}-detail`} aria-label={`${active.name} locker details`}>
        <header className="team-room-drawer-head"><div>{active.nickname && <span className="team-room-detail-kicker">{COPY.roomYourNickname}</span>}<h2>{active.nickname ? `“${active.nickname}”` : active.name}</h2><p>{[active.nickname && active.name, active.position, active.team, active.slot !== active.position && active.slot].filter(Boolean).join(" · ")}</p></div><button className="btn-ghost" onClick={close} aria-label="Close locker">×</button></header>
        <div className="team-room-detail-grid"><div><span className="team-room-detail-label">{COPY.roomPregameProjection}</span><div className="team-room-detail-score"><strong>{roomForecast(active)}</strong>{!roomOnBye(active) && <small>pts</small>}</div>
          <p>{roomOnBye(active) ? COPY.roomBye : active.projection == null ? active.projection_status === "not_saved" ? COPY.projectionNotSaved : COPY.projectionMissing : `${COPY.roomRecorded}: ${roomNumber(active.points)} · ${COPY.roomStates[data.state]}`}</p>
          {roomDelta(active, data.state) != null && <p className={roomDelta(active, data.state) >= 0 ? "positive" : ""}>{roomDelta(active, data.state) > 0 ? "+" : ""}{roomNumber(roomDelta(active, data.state))} vs projection</p>}
          {data.can_edit && active.can_manage !== false && onNickname && <details key={active.player_id} className="team-room-nickname-edit"><summary>Edit nickname</summary><form onSubmit={(e) => { e.preventDefault(); onNickname(active.player_id, nickname); }}><label>{COPY.nicknameLabel}<input maxLength={40} value={nickname} onChange={(e) => setNickname(e.target.value)} /></label><div className="team-room-drawer-actions"><button className="btn-ghost" disabled={busy}>Save nickname</button><button type="button" className="btn-link" disabled={busy} onClick={() => onNickname(active.player_id, null)}>{COPY.resetNickname}</button></div></form></details>}
        </div><div><dl className="team-room-detail-facts"><div><dt>{COPY.roomPosition}</dt><dd>{active.position} · {active.team}</dd></div><div><dt>{COPY.roomSlot}</dt><dd>{active.slot || COPY.roomBenchHeading}</dd></div></dl>
          <p>{active.kickoff_available === false ? COPY.roomKickoffMissing : active.lineup_locked ? COPY.roomLocked : active.lineup_locked === false ? COPY.roomNotStarted : COPY.roomStates[data.state]}</p>
          <div className="team-room-detail-links">{data.can_edit && active.can_manage !== false && onContract && <button className="btn-link" onClick={(e) => onContract(active.player_id, e.currentTarget)}>View contract</button>}
          {data.can_edit && onLineup && <button className="btn-link" onClick={onLineup}>{COPY.manageLineup} →</button>}
          {data.can_edit && data.lineup_host === "sleeper" && sleeperHref && <a className="btn-link" href={sleeperHref} target="_blank" rel="noreferrer">{COPY.roomViewSleeper} ↗</a>}</div>
        </div>{data.can_edit && slotIndex >= 0 && <div className="team-room-swap-panel"><h3>{saves ? COPY.roomStartSomeone(active.slot || active.position) : COPY.roomBenchCompare}</h3>
          {eligible.length ? eligible.map((p) => <button className="btn-ghost team-room-bench-pick" key={p.player_id} aria-pressed={candidate === p.player_id} disabled={!canPlaceRoomPlayer(data, active, p, slotIndex)} onClick={() => setCandidate(p.player_id)}><span>{p.name}{p.lineup_locked ? ` · ${COPY.roomHeldLocked}` : ""}</span><b>{roomForecast(p)}</b></button>) : <p>{COPY.roomNoBenchOption}</p>}
          {incoming && <><div className="team-room-swap-action">{swapChange != null && <strong className={swapChange > 0 ? "positive" : ""}>{signed(swapChange)} <small>pts</small></strong>}<button className="btn-primary" disabled={!canSwap} onClick={() => place(incoming.player_id, slotIndex)}>{saves ? COPY.roomStartAt(incoming.name, active.slot || active.position) : COPY.roomPreviewSwap}</button></div>
            <p>{incoming.projection == null ? saves ? COPY.projectionMissing : COPY.roomCompareMissing : saves ? "" : COPY.roomSleeperPreview}</p></>}
        </div>}</div>
      </section>}
    </div>}
    {section === "starters" && hasStarters && lineup.bench.length > 0 && !showRack && <section className="team-room-bench-section"><div className="team-room-bench-heading"><h2>{COPY.roomBenchHeading} · {lineup.bench.length}</h2>{data.can_edit && <span>{COPY.roomBenchHint}</span>}</div><div className="team-room-bench-players">
      {lineup.bench.map((p, i) => { const colors = nflTeamColors(p.team), usable = usableBench(p), edge = usable ? roomBenchEdge(data, p, lineup.starters) : null; return <button type="button" className={`team-room-bench-player${dragging === p.player_id ? " is-held" : ""}`} key={p.player_id} draggable={usable} aria-pressed={candidate === p.player_id} aria-label={COPY.roomDragPlayer(p.name)}
        onDragStart={(e) => { if (!usable) { e.preventDefault(); return; } setDragging(p.player_id); e.dataTransfer.setData("text/plain", p.player_id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDragging(null)}
        onClick={(e) => { trigger.current = e.currentTarget; if (data.can_edit) compareBench(p); else { setSection("bench"); setSelected(p.player_id); } }}>
        <JerseySvg detailed colors={colors.jersey} number={data.media?.[p.player_id]?.jersey_number} gradientId={`${id}-bench-${i}`} /><span className="team-room-bench-identity"><b>{p.name}</b><small>{p.position} · {p.team}</small>{p.nickname && <small>“{p.nickname}”</small>}{p.lineup_locked ? <small>{p.kickoff_available === false ? COPY.roomKickoffMissing : COPY.roomLocked}</small> : edge ? <small className="team-room-bench-edge">{COPY.roomBeats(edge.delta, edge.surname)}</small> : data.can_edit && !usable && ["pregame", "live"].includes(data.state) ? <small>{COPY.roomNoOpenSlot}</small> : null}</span><span className="team-room-bench-projection"><strong>{roomForecast(p)}</strong>{!roomOnBye(p) && <small>{COPY.roomProjectionLabel}</small>}</span>
      </button>; })}
    </div></section>}
    {showRack && <div className="team-room-rack" data-bottom-actions aria-label={COPY.roomRackLabel}>
      {heldPlayer && carry ? <div className="team-room-rack-carry"><JerseySvg detailed colors={nflTeamColors(heldPlayer.team).jersey} number={data.media?.[heldPlayer.player_id]?.jersey_number} gradientId={`${id}-carry`} /><span>{COPY.roomHolding(heldPlayer.name)}</span><button type="button" className="btn-ghost" onClick={() => setCarry(null)}>{COPY.roomPutBack}</button></div>
        : <div className="team-room-rack-head"><span>{COPY.roomBenchHeading} · {lineup.bench.length}</span><span>{COPY.roomRackHint}</span></div>}
      <div className="team-room-rack-chips">
        {lineup.bench.map((p, i) => { const usable = usableBench(p), edge = usable ? roomBenchEdge(data, p, lineup.starters) : null; return <button type="button" key={p.player_id} className={`team-room-rack-chip${p.lineup_locked ? " is-locked" : ""}`} disabled={!usable} aria-pressed={carry === p.player_id} aria-label={`${carry === p.player_id ? COPY.roomPutDown(p.name) : COPY.roomPickUp(p.name)} · ${roomOnBye(p) ? COPY.roomBye : p.lineup_locked ? COPY.roomHeldLocked : p.projection == null ? COPY.projectionMissing : `${roomForecast(p)} ${COPY.roomProjectionLabel.toLowerCase()}`}`} onClick={() => pickUp(p)}>
          <JerseySvg detailed colors={nflTeamColors(p.team).jersey} number={data.media?.[p.player_id]?.jersey_number} gradientId={`${id}-rack-${i}`} /><span><b>{p.name}</b><small>{roomOnBye(p) ? `${p.position} · ${COPY.roomBye}` : p.lineup_locked ? COPY.roomHeldLocked : edge ? COPY.roomBeats(edge.delta, edge.surname) : `${p.position} · ${roomForecast(p)}`}</small></span>
        </button>; })}
      </div>
      {status}
    </div>}
    {!hasStarters && status}
    <div className="team-room-floor" aria-hidden="true"><span className="team-room-bench" /><span className="team-room-floor-mark">{(data.team.name || "").split(/\s+/).map((s) => s[0]).slice(0, 2).join("")}</span></div>
  </section>;
}
