/* My team · Room lineup editing · A (lockers answer the drag) and B (coach's notes).
   In-memory only: no league writes, remote assets or polling. Jerseys reuse the room's SVG. */
const variant = document.body.dataset.variant || "drag";
const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"];
const FLEX = ["RB", "WR", "TE"];
const ROWS = [
  // id, name, pos, team, number, proj, kickoff, c1, c2, starting slot index, nickname
  ["hurts", "Jalen Hurts", "QB", "PHI", 1, 22.4, "Sun 1:00", "#004c54", "#002b30", 0],
  ["bijan", "Bijan Robinson", "RB", "ATL", 7, 19.8, "Sun 4:25", "#a71930", "#5a0d1a", 1],
  ["hall", "Breece Hall", "RB", "NYJ", 20, 13.0, "Sun 1:00", "#125740", "#003a2a", 2],
  ["lamb", "CeeDee Lamb", "WR", "DAL", 88, 21.2, "Sun 8:20", "#003594", "#001a4a", 3],
  ["nabers", "Malik Nabers", "WR", "NYG", 1, 17.0, "Sun 1:00", "#0b2265", "#061238", 4, "The neighborhood"],
  ["pitts", "Kyle Pitts", "TE", "ATL", 8, 9.0, "Sun 4:25", "#a71930", "#5a0d1a", 5],
  ["waddle", "Jaylen Waddle", "WR", "MIA", 17, 12.6, "Sun 1:00", "#008e97", "#004b50", 6],
  ["mcpherson", "Evan McPherson", "K", "CIN", 2, 8.5, "Sun 1:00", "#fb4f14", "#8a2a08", 7],
  ["jaguars", "Jaguars D/ST", "DEF", "JAX", "", 7.0, "Sun 1:00", "#006778", "#003640", 8],
  ["smith", "DeVonta Smith", "WR", "PHI", 6, 15.1, "Sun 1:00", "#004c54", "#002b30", null],
  ["charbonnet", "Zach Charbonnet", "RB", "SEA", 26, 10.4, "Sun 4:05", "#002244", "#071422", null],
  ["daniels", "Jayden Daniels", "QB", "WAS", 5, 21.5, "Sun 1:00", "#5a1414", "#2d0a0a", null],
  ["kelce", "Travis Kelce", "TE", "KC", 87, 14.8, "Mon 8:15", "#e31837", "#7a0c1d", null, "Big Yeti"],
  ["downs", "Josh Downs", "WR", "IND", 1, 11.6, "Sun 1:00", "#002c5f", "#001533", null],
  ["sutton", "Courtland Sutton", "WR", "DEN", 14, 8.1, "Thu 8:15", "#fb4f14", "#002244", null],
  ["andrews", "Mark Andrews", "TE", "BAL", 89, null, "Sun 1:00", "#241773", "#120a3a", null],
];
const OPP = { name: "Nine Lives", total: 127.9 };
const players = ROWS.map(([id, name, pos, team, num, proj, kickoff, c1, c2, slot, nick]) => ({ id, name, pos, team, num, proj, kickoff, c1, c2, slot, nick, actual: proj == null ? null : Math.round((proj + (id.length % 3) - 1) * 10) / 10 }));
const byId = Object.fromEntries(players.map((p) => [p.id, p]));
const SAVED = ROWS.filter((r) => r[9] != null).sort((a, b) => a[9] - b[9]).map((r) => r[0]);
const SAVED_BENCH = players.filter((p) => p.slot == null).map((p) => p.id);
let starters = [...SAVED];
let bench = [...SAVED_BENCH];
const state = { view: "room", sleeper: false, live: false, stakes: true, selected: null, candidate: null, carry: null, lastMove: null, notice: "", picker: null };
let returnFocus = null, dragId = null;

const main = document.getElementById("main-content");
const phone = () => innerWidth <= 768;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v) => (v == null ? "—" : v.toFixed(1));
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
const initials = (p) => (p.pos === "DEF" ? p.team : p.name.split(" ").map((w) => w[0]).slice(0, 2).join(""));
const first = (p) => (p.pos === "DEF" ? p.team : p.name.split(" ").slice(-1)[0]);
const locked = (p) => p.id === "sutton" || (state.live && (p.kickoff.startsWith("Thu") || p.kickoff === "Sun 1:00"));
const eligible = (p, i) => (SLOTS[i] === "FLEX" ? FLEX.includes(p.pos) : p.pos === SLOTS[i]);
const fits = (p) => SLOTS.filter((s, i, arr) => arr.indexOf(s) === i).filter((s) => (s === "FLEX" ? FLEX.includes(p.pos) : p.pos === s));
const pointsFor = (p) => (locked(p) && p.actual != null ? p.actual : p.proj);
const total = (ids = starters) => ids.reduce((sum, id) => sum + (pointsFor(byId[id]) ?? 0), 0);
const missingCount = () => starters.filter((id) => pointsFor(byId[id]) == null).length;
const starterAt = (i) => byId[starters[i]];
const nextLock = () => (state.live ? "Sun 4:05 PM" : "Sun 1:00 PM");
const previewCount = () => starters.filter((id, i) => id !== SAVED[i]).length;
const openSlotFor = (p) => SLOTS.findIndex((_, i) => eligible(p, i) && !locked(starterAt(i)));

function bestBench(i) {
  const s = starterAt(i);
  if (!s || locked(s)) return null;
  const options = bench.map((id) => byId[id]).filter((p) => eligible(p, i) && !locked(p) && p.proj != null);
  if (!options.length) return null;
  options.sort((a, b) => b.proj - a.proj);
  return options[0];
}
function suggestion(i) {
  const s = starterAt(i), b = bestBench(i);
  if (!s || !b || s.proj == null) return null;
  const delta = b.proj - s.proj;
  return delta >= 1 ? { player: b, delta } : null;
}
const suggestions = () => SLOTS.map((_, i) => ({ i, s: suggestion(i) })).filter((x) => x.s);
const upside = () => suggestions().reduce((sum, x) => sum + x.s.delta, 0);
function bestBeat(p) {
  if (p.proj == null || locked(p)) return null;
  let best = null;
  SLOTS.forEach((_, i) => {
    const s = starterAt(i);
    if (!eligible(p, i) || locked(s) || s.proj == null) return;
    const delta = p.proj - s.proj;
    if (delta >= 1 && (!best || delta > best.delta)) best = { starter: s, delta };
  });
  return best;
}

function jersey(p, tag = "wall") {
  const gid = `jersey-${tag}-${p.id}`;
  return `<svg class="jersey" viewBox="18 0 84 96" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="${p.c1}"/><stop offset="1" stop-color="${p.c2}"/></linearGradient></defs><path d="M60 2q0 6-7 8l-1 2h16l-1-2q-7-2-7-8" fill="none" stroke="#ded7c4aa" stroke-width="2.4"/><path d="M42 14L52 10Q60 16 68 10L78 14L98 26L90 44L82 38L82 88Q60 94 38 88L38 38L30 44L22 26Z" fill="url(#${gid})" stroke="#0008" stroke-width="1.4"/><path d="M22 26L30 44L34 41L26 24Z M98 26L90 44L86 41L94 24Z" fill="#ffffff38"/><path d="M52 10Q60 16 68 10L66 14Q60 19 54 14Z" fill="#0006"/><g fill="none"><path d="M39 40Q44 60 40 87M81 40Q76 60 80 87M48 24Q46 35 49 47M72 24Q74 35 71 47" stroke="#0005" stroke-width="2"/><path d="M40 86Q60 91 80 86M42 16L45 27M78 16L75 27" stroke="#ffffff55" stroke-width=".6" stroke-dasharray="1 1"/><path d="M26 29L32 39M94 29L88 39" stroke="#ffffffaa" stroke-width="2"/></g><text x="60" y="62" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="800" fill="#fffffff0" style="paint-order:stroke;stroke:#0006;stroke-width:2px">${p.num}</text></svg>`;
}
const face = (p, cls = "") => `<span class="face ${cls}" style="--c1:${p.c1};--c2:${p.c2}" aria-hidden="true">${esc(initials(p))}</span>`;
const ptsCell = (p) => locked(p)
  ? `<span class="pts is-final"><b>${fmt(p.actual)}</b><small>${state.live && p.kickoff === "Sun 1:00" ? "live" : "final"}</small></span>`
  : `<span class="pts"><b>${fmt(p.proj)}</b><small>${p.proj == null ? "no proj" : "proj"}</small></span>`;
const fitsChips = (p) => `<span class="fits" aria-label="Eligible slots">${fits(p).map((s) => `<span>${s}</span>`).join("")}</span>`;
const lockedPill = (p) => `<span class="quiet-pill is-locked">${p.kickoff.startsWith("Thu") || !state.live ? "Locked · played" : "Locked · live"}</span>`;

/* ---------- lineup state changes ---------- */
function applyMoves(moves) {
  const done = [];
  moves.forEach((m) => {
    const incoming = byId[m.inId], outgoing = starterAt(m.i);
    if (!incoming || !outgoing || !bench.includes(m.inId) || !eligible(incoming, m.i) || locked(incoming) || locked(outgoing)) return;
    starters[m.i] = m.inId;
    bench = bench.map((id) => (id === m.inId ? outgoing.id : id));
    done.push({ inId: m.inId, outId: outgoing.id, i: m.i });
  });
  if (!done.length) { setNotice("That player can't start in that slot right now."); return false; }
  state.lastMove = { moves: done, saved: !state.sleeper };
  state.notice = ""; state.carry = null; dragId = null; state.selected = null; state.candidate = null;
  render();
  done.forEach((m) => main.querySelector(`[data-locker="${m.inId}"]`)?.classList.add("swap-enter"));
  const names = done.map((m) => `${byId[m.inId].name} at ${SLOTS[m.i]}`).join(", ");
  announce(`${state.sleeper ? "Preview updated" : "Lineup saved"}. ${names}. ${done.map((m) => byId[m.outId].name).join(" and ")} to the bench.`);
  document.getElementById("lineup-status")?.focus({ preventScroll: true });
  return true;
}
function undo() {
  const m = state.lastMove;
  if (!m) return;
  [...m.moves].reverse().forEach((x) => { starters[x.i] = x.outId; bench = bench.map((id) => (id === x.outId ? x.inId : id)); });
  state.lastMove = null;
  state.notice = `Undone · ${m.moves.map((x) => `${byId[x.outId].name} starts at ${SLOTS[x.i]}`).join(", ")} again.`;
  render();
  announce(state.notice);
}
function resetPreview() {
  starters = [...SAVED]; bench = [...SAVED_BENCH]; state.lastMove = null; state.carry = null;
  state.notice = "Preview reset · your Sleeper lineup is unchanged.";
  render();
  announce(state.notice);
}
function setNotice(text) { state.notice = text; state.lastMove = state.lastMove; const el = document.getElementById("lineup-status"); if (el && !state.lastMove) { el.hidden = false; el.className = "lineup-status is-quiet"; el.textContent = text; } announce(text); }
function announce(text) { const el = document.getElementById("lineup-announcement"); if (el) { el.textContent = ""; setTimeout(() => (el.textContent = text), 20); } }

/* ---------- shared pieces ---------- */
function statusLine() {
  if (state.lastMove) {
    const { moves, saved } = state.lastMove;
    const text = moves.length === 1
      ? `<b>${esc(byId[moves[0].inId].name)}</b> starts at ${SLOTS[moves[0].i]}; ${esc(byId[moves[0].outId].name)} moves to the bench.`
      : `${moves.length} changes: ${moves.map((m) => `<b>${esc(first(byId[m.inId]))}</b> at ${SLOTS[m.i]}`).join(", ")}.`;
    if (saved) return `<div class="lineup-status is-saved" id="lineup-status" role="status" tabindex="-1"><span class="status-kicker">Saved</span><span class="status-text">${text}</span><button class="text-link" data-undo>Undo</button></div>`;
    return `<div class="lineup-status is-preview" id="lineup-status" role="status" tabindex="-1"><span class="status-kicker">Preview</span><span class="status-text">${text} Sleeper owns the saved lineup.</span><a class="text-link" href="#" data-preview="Sleeper · set lineup">Set lineup in Sleeper ↗</a><button class="text-link" data-reset>Reset</button></div>`;
  }
  if (state.notice) return `<div class="lineup-status is-quiet" id="lineup-status" role="status">${esc(state.notice)}</div>`;
  return `<div class="lineup-status" id="lineup-status" role="status" hidden></div>`;
}
function tabs(active) {
  const items = [["room", "Room"], ["lineup", "Lineup"], ["manage", "Manage roster"]];
  return `<div class="my-team-tabs" role="group" aria-label="My team view">${items.map(([k, label]) => k === active ? `<button type="button" aria-pressed="true">${label}</button>` : k === "manage" ? `<button type="button" aria-pressed="false" data-preview="My team · Manage roster">${label}</button>` : `<button type="button" aria-pressed="false" data-view="${k}">${label}</button>`).join("")}</div>`;
}
function lockChip() {
  return `<span class="lock-chip ${state.live ? "is-live" : ""}">${state.live ? "Games in progress · next lock " + nextLock() : "Next lock " + nextLock()}</span>`;
}
function weekStepper() {
  return `<div class="week-stepper" role="group" aria-label="Week"><button data-preview="Week 5" aria-label="Previous week">‹</button><button class="week-current" data-preview="Choose week" aria-haspopup="listbox">Week 6 ▾</button><button data-preview="Week 7" aria-label="Next week">›</button></div>`;
}
function notesChip() {
  const n = suggestions().length;
  if (!n) return `<span class="quiet-pill">No notes · best lineup set</span>`;
  return `<button class="call-pill" data-first-note aria-label="${n} ${n === 1 ? "note" : "notes"} worth ${signed(upside())} points. Go to the first.">${n} ${n === 1 ? "note" : "notes"} · ${signed(upside())}</button>`;
}

/* ---------- Room ---------- */
function roomHead() {
  return `<header class="room-head"><span class="crest" aria-hidden="true">SR</span><div><h1>Sunday Roster</h1><p class="owner">Maya Chen · Your team</p></div><div class="room-actions"><button data-preview="Visit team · manager picker">Visit team ↗</button><button data-preview="Team appearance">Edit look</button><button data-preview="Share room · revocable public link">Share room</button></div></header>
  <div class="room-tools"><span class="week-label">Week 6 · ${state.live ? "Games in progress" : "Pregame"}</span>${lockChip()}<button class="text-action" data-preview="Game center · Sunday Roster · Week 6">Game center →</button></div>`;
}
function scoreboard() {
  const t = total(), base = total(SAVED), d = t - base, moved = state.lastMove || previewCount();
  const gap = t - OPP.total, missing = missingCount();
  const change = moved && Math.abs(d) >= 0.05 ? `<span class="change ${d >= 0 ? "gain" : ""}">${signed(d)}<br><span class="owner">${state.sleeper ? "vs Sleeper lineup" : "this visit"}</span></span>` : "";
  const note = variant === "notes"
    ? `${notesChip()}<span>${state.sleeper ? "A note previews the swap; Sleeper makes the change." : "Tap a note to make the change. Undo any time."}</span>`
    : `<strong>${state.sleeper ? "Sleeper owns this lineup." : "Dropping a jersey saves your lineup."}</strong>${phone() ? "Pick up a bench jersey below; lockers that fit light up with the change." : "Drag a bench jersey; lockers that fit light up and show the change."}${state.sleeper ? " Previews here, changes in Sleeper." : ""}`;
  return `<div class="scoreboard"><div class="score-main"><span class="score-label">${state.sleeper && previewCount() ? "Preview lineup" : "Starting lineup"} · Week 6 ${state.live ? "points" : "PPR projection"}</span><div class="total-wrap"><div class="total" id="team-total">${fmt(t)}<small>pts</small></div>${change}</div>${missing ? `<span class="owner">${missing} starter without a forecast</span>` : ""}</div>
    ${state.stakes ? `<div class="stakes"><span class="score-label">vs ${OPP.name} · ${state.live ? "live" : "projected"}</span><div class="stakes-row"><b>${fmt(OPP.total)}</b><small>pts</small><span class="gap ${gap >= 0 ? "is-ahead" : ""}">${gap >= 0 ? "You lead by" : "You trail by"} ${Math.abs(gap).toFixed(1)}</span></div></div>` : ""}
    <div class="lineup-note">${note}</div></div>`;
}
function locker(id, i) {
  const p = byId[id], isLocked = locked(p), s = suggestion(i);
  const btn = `<button class="locker ${isLocked ? "is-locked" : ""}" data-locker="${id}" data-slot="${i}" style="--offset:${Math.abs(i - 4) * 3}px" aria-label="Open ${esc(p.name)}'s locker · ${SLOTS[i]} · ${isLocked ? "locked" : p.proj == null ? "no forecast" : "projected " + fmt(p.proj)}" aria-expanded="${state.selected === id}" aria-controls="player-detail"><span class="locker-slot" data-plate>${SLOTS[i]}</span><span class="door" aria-hidden="true"><i></i></span><span class="jersey-bay">${jersey(p)}</span><span class="nameplate"><b>${esc(p.name)}</b>${p.nick ? `<span class="nickname">“${esc(p.nick)}”</span>` : ""}<small>${p.pos} · ${p.team} · ${p.kickoff}</small></span><span class="locker-proj"><b>${fmt(pointsFor(p))}</b><small>${isLocked ? (state.live && p.kickoff === "Sun 1:00" ? "live" : "final") : p.proj == null ? "no proj" : "proj"}</small></span><span class="vent" aria-hidden="true"></span></button>`;
  if (variant !== "notes") return btn;
  const note = isLocked
    ? `<span class="note is-quiet">Locked</span>`
    : s ? `<button class="note" data-note-slot="${i}" data-note-in="${s.player.id}" aria-label="${state.sleeper ? "Preview" : "Start"} ${esc(s.player.name)} at ${SLOTS[i]}, ${signed(s.delta)} points. ${esc(p.name)} moves to the bench.">${esc(first(s.player))} <b>${signed(s.delta)}</b></button>` : "";
  return `<div class="locker-shell">${btn}${note}</div>`;
}
function paintHeld(heldId) {
  const held = heldId ? byId[heldId] : null;
  main.querySelectorAll("[data-slot]").forEach((el) => {
    const i = Number(el.dataset.slot), p = starterAt(i), plate = el.querySelector("[data-plate]");
    el.classList.remove("is-open", "is-shut", "is-dim", "drag-over");
    if (!held) { plate.textContent = SLOTS[i]; return; }
    if (locked(p)) { el.classList.add("is-shut"); plate.textContent = "Locked"; return; }
    if (!eligible(held, i)) { el.classList.add("is-dim"); plate.textContent = SLOTS[i]; return; }
    el.classList.add("is-open");
    const d = held.proj != null && p.proj != null ? held.proj - p.proj : null;
    plate.innerHTML = d == null ? "Fits" : `<span class="delta ${d >= 0 ? "is-up" : "is-down"}">${signed(d)}</span>`;
  });
  main.querySelector(".room")?.classList.toggle("is-holding", Boolean(held));
}
function detail() {
  if (!state.selected) return "";
  const i = starters.indexOf(state.selected);
  if (i < 0) return "";
  const p = byId[state.selected], isLocked = locked(p);
  const options = bench.map((id) => byId[id]).filter((b) => eligible(b, i));
  const incoming = options.find((b) => b.id === state.candidate && !locked(b));
  const d = incoming && incoming.proj != null && p.proj != null ? incoming.proj - p.proj : null;
  const status = isLocked ? (state.live && p.kickoff === "Sun 1:00" ? "Playing now · locked" : "Game final · locked") : `Not started · locks ${p.kickoff}`;
  return `<section class="player-detail" id="player-detail" aria-label="${esc(p.name)} locker details"><header class="detail-head"><div><span class="detail-kicker">${p.nick ? "YOUR NICKNAME" : p.team + " · " + p.pos}</span><h2>${p.nick ? "“" + esc(p.nick) + "”" : esc(p.name)}</h2><p class="detail-subtitle">${p.nick ? esc(p.name) + " · " : ""}${p.pos} · ${p.team} · ${SLOTS[i]} slot</p></div><button class="close" data-close aria-label="Close player details">×</button></header>
    <div class="detail-body"><div><span class="score-label">Week 6 · PPR ${isLocked ? "points" : "projection"}</span><div class="projection-readout"><strong>${fmt(pointsFor(p))}</strong><span>pts</span></div><p class="owner">${p.proj == null ? "Projection unavailable" : status}</p><details class="nickname-form"><summary>Edit nickname</summary><form class="nickname-fields"><label>Player nickname<input name="nickname" maxlength="40" value="${esc(p.nick || "")}" autocomplete="off"></label><button type="submit">Save</button></form></details></div>
    <div><dl class="detail-facts"><div><dt>NFL team</dt><dd>${p.team}</dd></div><div><dt>Lineup spot</dt><dd>${SLOTS[i]}</dd></div><div><dt>Kickoff</dt><dd>${p.kickoff}</dd></div><div><dt>Lineup status</dt><dd>${isLocked ? "Locked" : "Can change"}</dd></div></dl><div class="detail-links"><button class="text-action" data-preview="Manage roster · ${esc(p.name)} contract">View contract →</button>${state.sleeper ? `<a class="text-action" href="#" data-preview="Sleeper · set lineup">Set lineup in Sleeper ↗</a>` : ""}</div></div>
    <div class="swap-panel"><h3>${isLocked ? "Slot locked" : state.sleeper ? "Try someone from your bench" : `Start someone else at ${SLOTS[i]}`}</h3>
      ${isLocked ? `<p>${esc(first(p))}'s game has started. This slot can't change this week.</p>` : options.length ? `<p>Eligible for ${SLOTS[i]}. Pick a player to compare.</p>${options.map((b) => `<button class="bench-pick" data-pick="${b.id}" aria-pressed="${state.candidate === b.id}" ${locked(b) ? "disabled" : ""}><span>${esc(b.name)}${locked(b) ? " · Locked" : ""}</span><b>${fmt(b.proj)}</b></button>`).join("")}` : `<p>No eligible bench players for ${SLOTS[i]}.</p><button class="text-action" data-preview="Free agents · ${SLOTS[i]}">Find ${SLOTS[i]} on Free agents →</button>`}
      ${incoming ? `<div class="swap-foot"><span class="swap-delta ${d != null && d >= 0 ? "gain" : ""}">${d == null ? "—" : signed(d)}<small class="owner"> pts</small></span><button class="swap-action" data-swap="${incoming.id}" data-swap-slot="${i}">${state.sleeper ? "Preview swap" : `Start ${esc(first(incoming))} at ${SLOTS[i]}`}</button></div><p>${state.sleeper ? "Sleeper owns this lineup; this is a projection preview." : d == null ? `No forecast for ${esc(first(incoming))}. Saves now; players lock at kickoff.` : "Saves now. Players lock at kickoff."}</p>` : ""}
    </div></div></section>`;
}
function benchPlayer(id) {
  const p = byId[id], isLocked = locked(p), open = openSlotFor(p), usable = !isLocked && open >= 0;
  const beat = variant === "drag" ? bestBeat(p) : null;
  const sub = isLocked ? `<small>Locked · ${p.kickoff.startsWith("Thu") || !state.live ? "played" : "live"}</small>` : beat ? `<small class="beats">${signed(beat.delta)} over ${esc(first(beat.starter))}</small>` : open < 0 ? `<small>No open slot</small>` : p.proj == null ? `<small>Projection unavailable</small>` : "";
  return `<button type="button" class="bench-player ${isLocked ? "is-locked" : ""}" data-bench="${id}" ${usable ? 'draggable="true"' : ""} ${isLocked ? "disabled" : ""} aria-pressed="${state.candidate === id}" aria-label="${esc(p.name)} · ${p.pos} · ${isLocked ? "game started, locked" : p.proj == null ? "projection unavailable" : fmt(p.proj) + " projected"}${usable ? ". Drag to a lit locker or press to compare." : ""}">${jersey(p, "bench")}<span class="identity"><b>${esc(p.name)}</b><small>${p.pos} · ${p.team} · ${p.kickoff}</small>${sub}</span><span class="bench-points">${fmt(p.proj)}<small>${p.proj == null ? "no proj" : "proj"}</small></span></button>`;
}
function benchSection() {
  return `<section class="bench-section" aria-label="Bench"><div class="bench-head"><h2>The bench <span>· ${bench.length} players</span></h2><span>${variant === "drag" ? "Drag a jersey to a lit locker, or tap to compare" : "Drag to a slot or tap to compare"}</span></div><div class="bench-list">${bench.map(benchPlayer).join("")}</div></section>`;
}
function rackChip(id) {
  const p = byId[id], isLocked = locked(p), usable = !isLocked && openSlotFor(p) >= 0;
  return `<button type="button" class="rack-chip ${isLocked ? "is-locked" : ""}" data-carry="${id}" ${usable ? "" : "disabled"} aria-pressed="${state.carry === id}" aria-label="${state.carry === id ? "Put down" : "Pick up"} ${esc(p.name)} · ${isLocked ? "locked" : p.proj == null ? "no forecast" : fmt(p.proj) + " projected"}">${jersey(p, "rack")}<span><b>${esc(first(p))}</b><small>${isLocked ? "Locked" : fmt(p.proj)}</small></span></button>`;
}
function rack() {
  const held = state.carry ? byId[state.carry] : null;
  const head = held
    ? `<div class="rack-carry">${jersey(held, "carry")}<span>Holding <b>${esc(held.name)}</b> · tap a lit locker</span><button class="btn btn-ghost btn-sm" data-cancel-carry>Put back</button></div>`
    : `<div class="rack-head"><b>The bench · ${bench.length}</b><span>Tap a jersey to pick it up</span></div>`;
  return `<div class="bench-rack" aria-label="Bench">${head}<div class="rack-chips">${bench.map(rackChip).join("")}</div>${rackStatus()}</div>`;
}
function rackStatus() {
  if (state.lastMove) {
    const { moves, saved } = state.lastMove;
    const text = `${moves.map((m) => `<b>${esc(first(byId[m.inId]))}</b> at ${SLOTS[m.i]}`).join(", ")} · ${moves.map((m) => esc(first(byId[m.outId]))).join(", ")} to bench`;
    return saved
      ? `<div class="lineup-status is-saved is-compact" id="lineup-status" role="status" tabindex="-1"><span class="status-kicker">Saved</span><span class="status-text">${text}</span><button class="text-link" data-undo>Undo</button></div>`
      : `<div class="lineup-status is-preview is-compact" id="lineup-status" role="status" tabindex="-1"><span class="status-kicker">Preview</span><span class="status-text">${text}</span><a class="text-link" href="#" data-preview="Sleeper · set lineup">Sleeper ↗</a><button class="text-link" data-reset>Reset</button></div>`;
  }
  if (state.notice) return `<div class="lineup-status is-quiet is-compact" id="lineup-status" role="status"><span class="status-text">${esc(state.notice)}</span></div>`;
  return "";
}
function renderRoom() {
  main.innerHTML = `${tabs("room")}<section class="room" aria-label="Sunday Roster team room">${roomHead()}${scoreboard()}${phone() ? "" : statusLine()}<div class="room-layout"><div class="wall-wrap"><div class="wall-caption"><h2>Starting lockers</h2><span>${variant === "notes" ? "A note hangs where your bench has a better option" : "Tap a locker for details"}</span></div><div class="locker-wall">${starters.map(locker).join("")}</div></div>${detail()}</div>${phone() ? "" : benchSection()}<div class="room-floor" aria-hidden="true">SR</div></section>${phone() ? rack() : ""}`;
}

/* ---------- Lineup tab (traditional) ---------- */
function lineupHead() {
  const n = suggestions().length;
  return `<header class="lineup-head"><div><p class="eyebrow">Week 6 · ${state.sleeper ? "Sleeper lineup" : "Saved lineup"}</p><h1>Your lineup</h1><div class="status-line"><span>Projections just now</span><button class="text-link" data-preview="Refresh projections">Refresh</button>${lockChip()}<button class="text-link" data-preview="Game center · Sunday Roster · Week 6">Open Game center →</button></div></div><div class="lineup-total"><span class="eyebrow">Projected starters</span><strong>${fmt(total())}<small>pts</small></strong><span class="upside">${n ? `<b>${signed(upside())}</b> available with ${n} suggested ${n === 1 ? "swap" : "swaps"}` : "Best projected lineup on your roster"}</span></div>${weekStepper()}</header>`;
}
function slotRow(id, i) {
  const p = byId[id], s = suggestion(i), b = bestBench(i), isLocked = locked(p);
  let next = "";
  if (isLocked) next = `<div class="next-best is-quiet"><span class="arrow">●</span>${state.live && p.kickoff === "Sun 1:00" ? "Playing now" : "Final"} · slot locked</div>`;
  else if (s) next = `<div class="next-best"><span class="arrow" aria-hidden="true">↑</span><span><b>${esc(s.player.name)}</b> ${fmt(s.player.proj)} on your bench · ${s.player.kickoff}</span><button class="call-pill" data-open-slot="${i}" data-preselect="${s.player.id}" aria-label="Start ${esc(s.player.name)} at ${SLOTS[i]}, ${signed(s.delta)} points">Start ${signed(s.delta)}</button></div>`;
  else if (b) next = `<div class="next-best is-quiet"><span class="arrow">✓</span>Best option here · ${esc(b.name)} ${fmt(b.proj)} is next</div>`;
  else next = `<div class="next-best is-quiet"><span class="arrow">—</span>No eligible bench player · <button class="text-link" data-preview="Free agents · ${SLOTS[i]}">Find ${SLOTS[i]}</button></div>`;
  return `<li class="slot-row ${s ? "is-suggested" : ""}"><button class="slot-btn" data-open-slot="${i}" ${isLocked ? "disabled" : ""} aria-label="${isLocked ? `${SLOTS[i]}: ${esc(p.name)} is locked` : `Change ${SLOTS[i]}: ${esc(p.name)}`}">${SLOTS[i]}</button>${face(p)}<div class="who"><b>${esc(p.name)}</b><small>${p.pos} · ${p.team} · ${p.kickoff}</small></div>${ptsCell(p)}${next}</li>`;
}
function benchRow(id) {
  const p = byId[id], isLocked = locked(p), open = openSlotFor(p);
  return `<li class="bench-row ${isLocked ? "is-locked" : ""}">${face(p)}<div class="who"><b>${esc(p.name)}</b><small>${p.pos} · ${p.team} · ${p.kickoff}</small></div>${fitsChips(p)}${ptsCell(p)}${isLocked ? lockedPill(p) : open < 0 ? `<span class="quiet-pill">No open slot</span>` : `<button class="btn btn-ghost btn-sm" data-open-bench="${p.id}" aria-label="Start ${esc(p.name)}">Start…</button>`}</li>`;
}
function lineupBar() {
  const n = suggestions().length;
  return `<div class="lineup-bar" aria-label="Lineup summary"><span class="bar-total"><strong>${fmt(total())} pts</strong><small>projected</small></span><span class="lock-chip ${state.live ? "is-live" : ""}">Locks ${nextLock().replace(" PM", "")}</span>${n ? `<button class="call-pill" data-best aria-label="Start best lineup, ${signed(upside())} points">Best ${signed(upside())}</button>` : ""}</div>`;
}
function renderLineup() {
  const n = suggestions().length;
  main.innerHTML = `${tabs("lineup")}${lineupHead()}${statusLine()}<div class="depth-grid">
    <section class="panel" aria-label="Starters"><div class="panel-head"><h2>Starters · ${SLOTS.length}</h2>${n ? `<button class="btn btn-ghost btn-sm" data-best>Start best lineup · ${signed(upside())}</button>` : `<span class="meta">Tap a slot to change who starts</span>`}</div><ul class="slot-list">${starters.map(slotRow).join("")}</ul></section>
    <section class="panel bench-col" aria-label="Bench"><div class="panel-head"><h2>Bench · ${bench.length}</h2><span class="meta">Eligible slots shown</span></div><ul class="bench-rows">${bench.map(benchRow).join("")}</ul></section></div>${lineupBar()}`;
}

/* ---------- picker (approved Lineup A interaction) + best-lineup review ---------- */
const dialog = document.getElementById("lineup-picker");
function openSlotPicker(i, preselect = null, opener = null) {
  returnFocus = opener;
  const options = bench.map((id) => byId[id]).filter((p) => eligible(p, i));
  state.picker = { mode: "slot", i, choice: preselect && options.some((p) => p.id === preselect && !locked(p)) ? preselect : null };
  renderPicker();
  if (!dialog.open) dialog.showModal();
}
function openBenchPicker(id, opener = null) {
  returnFocus = opener;
  const slots = SLOTS.map((_, i) => i).filter((i) => eligible(byId[id], i) && !locked(starterAt(i)));
  state.picker = { mode: "bench", id, choice: slots.length === 1 ? slots[0] : null };
  renderPicker();
  if (!dialog.open) dialog.showModal();
}
function openBest(opener = null) {
  returnFocus = opener;
  state.picker = { mode: "best" };
  renderPicker();
  if (!dialog.open) dialog.showModal();
}
function closePicker() {
  state.picker = null;
  if (dialog.open) dialog.close();
  returnFocus?.focus?.({ preventScroll: true });
}
const pickerFoot = (enabled, label) => `<div class="picker-foot"><p class="lock-note">${state.sleeper ? "Lineups are managed in Sleeper. This preview does not change your lineup." : "Players lock at kickoff."}</p><div class="picker-actions"><button class="btn btn-ghost" data-close>Cancel</button>${state.sleeper ? `<a class="btn btn-primary" href="#" data-preview="Sleeper · set lineup">Set lineup in Sleeper ↗</a>` : `<button class="btn btn-primary" data-confirm ${enabled ? "" : "disabled"}>${label}</button>`}</div></div>`;
const previewPair = (cur, inc, slot) => `<div class="picker-preview"><div class="preview-cell"><p class="eyebrow">To bench</p>${face(cur)}<b>${esc(cur.name)}</b><small>${fmt(cur.proj)} proj pts</small></div><span class="preview-swap" aria-hidden="true">⇄</span><div class="preview-cell"><p class="eyebrow">To ${slot}</p>${face(inc)}<b>${esc(inc.name)}</b><small>${fmt(inc.proj)} proj pts</small></div></div>`;
const deltaLine = (d) => `<p class="picker-delta">${d == null ? "Projection unavailable for this comparison." : `<span class="delta ${d >= 0 ? "is-up" : "is-down"}">${signed(d)}</span> projected lineup points`}</p>`;
function renderPicker() {
  const pk = state.picker;
  if (!pk) return;
  const body = dialog.querySelector(".picker-body");
  let html;
  if (pk.mode === "slot") {
    const i = pk.i, cur = starterAt(i), options = bench.map((id) => byId[id]).filter((p) => eligible(p, i));
    const choice = pk.choice ? byId[pk.choice] : null, delta = choice && choice.proj != null && cur.proj != null ? choice.proj - cur.proj : null;
    html = `<div class="picker-head"><div><p class="eyebrow">${SLOTS[i]} · Lineup</p><h2 id="picker-title">Who starts at ${SLOTS[i]}?</h2></div><button class="picker-close" data-close aria-label="Close position picker">×</button></div>
      <div class="picker-current">${face(cur)}<div class="who"><p class="eyebrow">Currently starting</p><b>${esc(cur.name)}</b><small>${cur.pos} · ${cur.team} · ${cur.kickoff}</small></div>${ptsCell(cur)}</div>
      <p class="picker-help">Choose an eligible bench player.</p>
      <div class="picker-options" role="radiogroup" aria-label="Eligible bench players">${options.map((p) => { const d = p.proj != null && cur.proj != null ? p.proj - cur.proj : null;
        return `<button role="radio" class="pick" data-choose="${p.id}" aria-checked="${pk.choice === p.id}" ${locked(p) ? "disabled" : ""} aria-label="${esc(p.name)}${locked(p) ? ", locked" : ""}">${face(p)}<div class="who"><b>${esc(p.name)}</b><small>${p.pos} · ${p.team} · ${p.kickoff}</small>${locked(p) ? `<small class="pick-delta">Game started · locked</small>` : d == null ? `<small class="pick-delta">Projection unavailable</small>` : `<small class="pick-delta delta ${d >= 0 ? "is-up" : "is-down"}">${signed(d)} pts</small>`}</div>${ptsCell(p)}<span class="radio" aria-hidden="true"></span></button>`; }).join("") || `<p class="meta">No eligible bench players. <button class="text-link" data-preview="Free agents · ${SLOTS[i]}">Find ${SLOTS[i]} on Free agents</button></p>`}</div>
      ${choice ? previewPair(cur, choice, SLOTS[i]) + deltaLine(delta) : ""}${pickerFoot(Boolean(choice), choice ? `Start ${esc(choice.name)} at ${SLOTS[i]}` : "Choose a player")}`;
  } else if (pk.mode === "bench") {
    const p = byId[pk.id], slots = SLOTS.map((_, i) => i).filter((i) => eligible(p, i));
    const i = pk.choice, cur = i != null ? starterAt(i) : null, delta = cur && p.proj != null && cur.proj != null ? p.proj - cur.proj : null;
    html = `<div class="picker-head"><div><p class="eyebrow">Bench · Lineup</p><h2 id="picker-title">Where does ${esc(first(p))} start?</h2></div><button class="picker-close" data-close aria-label="Close position picker">×</button></div>
      <div class="picker-current">${face(p)}<div class="who"><p class="eyebrow">From your bench</p><b>${esc(p.name)}</b><small>${p.pos} · ${p.team} · ${p.kickoff}</small></div>${ptsCell(p)}</div>
      <p class="picker-help">Choose an eligible starting slot.</p>
      <div class="picker-options" role="radiogroup" aria-label="Eligible slots">${slots.map((si) => { const s = starterAt(si), d = p.proj != null && s.proj != null ? p.proj - s.proj : null, dis = locked(s);
        return `<button role="radio" class="pick" data-choose-slot="${si}" aria-checked="${pk.choice === si}" ${dis ? "disabled" : ""} aria-label="${SLOTS[si]}: ${esc(s.name)}${dis ? ", locked" : ""}">${face(s)}<div class="who"><b>${SLOTS[si]} · ${esc(s.name)}</b><small>${s.pos} · ${s.team} · ${s.kickoff}</small>${dis ? `<small class="pick-delta">Game started · locked</small>` : d == null ? `<small class="pick-delta">Projection unavailable</small>` : `<small class="pick-delta delta ${d >= 0 ? "is-up" : "is-down"}">${signed(d)} pts</small>`}</div>${ptsCell(s)}<span class="radio" aria-hidden="true"></span></button>`; }).join("")}</div>
      ${cur ? previewPair(cur, p, SLOTS[i]) + deltaLine(delta) : ""}${pickerFoot(Boolean(cur), cur ? `Start ${esc(p.name)} at ${SLOTS[i]}` : "Choose a slot")}`;
  } else {
    const list = suggestions();
    html = `<div class="picker-head"><div><p class="eyebrow">Lineup · Review</p><h2 id="picker-title">Start your best lineup?</h2></div><button class="picker-close" data-close aria-label="Close review">×</button></div>
      <p class="picker-help">${list.length} ${list.length === 1 ? "change" : "changes"} from your bench, by projection. Locked slots are left alone.</p>
      <div class="best-list">${list.map(({ i, s }) => `<div class="best-row">${face(s.player)}<div class="who"><b>${SLOTS[i]} · ${esc(s.player.name)}</b><small>replaces ${esc(starterAt(i).name)} · ${s.player.kickoff}</small></div><span class="delta is-up">${signed(s.delta)}</span></div>`).join("")}</div>
      <p class="picker-delta"><span class="delta is-up">${signed(upside())}</span> projected lineup points · ${fmt(total())} → ${fmt(total() + upside())}</p>
      ${pickerFoot(list.length > 0, `Start these ${list.length}`)}`;
  }
  body.innerHTML = html;
}
function confirmPicker() {
  const pk = state.picker;
  if (!pk) return;
  let moves;
  if (pk.mode === "slot") moves = pk.choice ? [{ inId: pk.choice, i: pk.i }] : [];
  else if (pk.mode === "bench") moves = pk.choice != null ? [{ inId: pk.id, i: pk.choice }] : [];
  else moves = suggestions().map((x) => ({ inId: x.s.player.id, i: x.i }));
  if (!moves.length) return;
  closePicker();
  applyMoves(moves);
}

/* ---------- wiring ---------- */
function render() {
  if (state.view === "room") renderRoom(); else renderLineup();
  if (state.carry) paintHeld(state.carry);
}
function openLocker(id, el) {
  state.selected = state.selected === id ? null : id;
  state.candidate = null;
  if (state.selected) { const i = starters.indexOf(id); const b = bestBench(i); state.candidate = b ? b.id : null; }
  render();
  main.querySelector(`[data-locker="${id}"]`)?.focus({ preventScroll: true });
  if (state.selected && phone()) document.getElementById("player-detail")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" });
}
function closeLocker() { const id = state.selected; state.selected = null; state.candidate = null; render(); main.querySelector(`[data-locker="${id}"]`)?.focus({ preventScroll: true }); }
function swing(el) { if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return; const j = el.querySelector(".jersey"); if (!j) return; j.classList.remove("swing"); void j.offsetWidth; j.classList.add("swing"); j.addEventListener("animationend", () => j.classList.remove("swing"), { once: true }); }
let holdTimer = null, holdTarget = null, holdX = 0, holdY = 0, suppressClick = false;
const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
main.addEventListener("pointerdown", (e) => { const el = e.target.closest("[data-locker]"); if (!el || !e.isPrimary || e.button !== 0) return; cancelHold(); holdTarget = el; holdX = e.clientX; holdY = e.clientY; suppressClick = false; holdTimer = setTimeout(() => { holdTimer = null; suppressClick = true; swing(el); }, 450); });
main.addEventListener("pointermove", (e) => { if (Math.hypot(e.clientX - holdX, e.clientY - holdY) > 9) cancelHold(); });
["pointerup", "pointercancel", "pointerleave"].forEach((t) => main.addEventListener(t, cancelHold));
main.addEventListener("click", (e) => {
  const view = e.target.closest("[data-view]");
  if (view) { state.view = view.dataset.view; state.selected = null; state.carry = null; render(); main.querySelector(".my-team-tabs [aria-pressed=true]")?.focus(); return; }
  const lockerEl = e.target.closest("[data-locker]");
  if (lockerEl) {
    if (suppressClick && lockerEl === holdTarget) { suppressClick = false; return; }
    const i = Number(lockerEl.dataset.slot);
    if (state.carry) {
      const held = byId[state.carry];
      if (locked(starterAt(i))) { setNotice(`${SLOTS[i]} is locked. ${held.name} is still in your hand.`); return; }
      if (!eligible(held, i)) { setNotice(`${held.name} doesn't fit at ${SLOTS[i]}. Tap a lit locker.`); return; }
      applyMoves([{ inId: held.id, i }]);
      return;
    }
    openLocker(lockerEl.dataset.locker, lockerEl);
    return;
  }
  if (e.target.closest("[data-close]") && !e.target.closest("dialog")) { closeLocker(); return; }
  const pick = e.target.closest("[data-pick]");
  if (pick) { state.candidate = pick.dataset.pick; render(); main.querySelector(`[data-pick="${state.candidate}"]`)?.focus({ preventScroll: true }); return; }
  const swap = e.target.closest("[data-swap]");
  if (swap) { applyMoves([{ inId: swap.dataset.swap, i: Number(swap.dataset.swapSlot) }]); return; }
  const benchBtn = e.target.closest("[data-bench]");
  if (benchBtn) {
    const p = byId[benchBtn.dataset.bench];
    let i = starters.indexOf(state.selected);
    if (i < 0 || !eligible(p, i) || locked(starterAt(i))) i = openSlotFor(p);
    if (i < 0) { setNotice(`No open slot for ${p.name} this week.`); return; }
    state.selected = starters[i]; state.candidate = p.id; render();
    document.getElementById("player-detail")?.scrollIntoView({ behavior: "instant", block: "nearest" });
    main.querySelector(`[data-pick="${p.id}"]`)?.focus({ preventScroll: true });
    return;
  }
  const carry = e.target.closest("[data-carry]");
  if (carry) { state.carry = state.carry === carry.dataset.carry ? null : carry.dataset.carry; state.selected = null; render(); main.querySelector(`[data-carry="${carry.dataset.carry}"]`)?.focus({ preventScroll: true }); if (state.carry) announce(`Holding ${byId[state.carry].name}. Lockers that fit are lit. Tap one to start them there.`); return; }
  if (e.target.closest("[data-cancel-carry]")) { state.carry = null; render(); return; }
  const note = e.target.closest("[data-note-slot]");
  if (note) { applyMoves([{ inId: note.dataset.noteIn, i: Number(note.dataset.noteSlot) }]); return; }
  const firstNote = e.target.closest("[data-first-note]");
  if (firstNote) { const target = main.querySelector("button.note"); if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); target.focus({ preventScroll: true }); } return; }
  if (e.target.closest("[data-undo]")) { undo(); return; }
  if (e.target.closest("[data-reset]")) { resetPreview(); return; }
  const slot = e.target.closest("[data-open-slot]");
  if (slot) { openSlotPicker(Number(slot.dataset.openSlot), slot.dataset.preselect || null, slot); return; }
  const ob = e.target.closest("[data-open-bench]");
  if (ob) { openBenchPicker(ob.dataset.openBench, ob); return; }
  const best = e.target.closest("[data-best]");
  if (best) { openBest(best); }
});
main.addEventListener("submit", (e) => { e.preventDefault(); const input = e.target.querySelector("[name=nickname]"); if (!input || !state.selected) return; byId[state.selected].nick = input.value.trim(); state.notice = "Nickname saved on the nameplate and player card."; render(); main.querySelector(`[data-locker="${state.selected}"]`)?.focus({ preventScroll: true }); });
main.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (state.carry) { e.preventDefault(); state.carry = null; render(); return; } if (state.selected) { e.preventDefault(); closeLocker(); } });
main.addEventListener("dragstart", (e) => { const b = e.target.closest("[data-bench]"); if (!b) return; cancelHold(); dragId = b.dataset.bench; e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; paintHeld(dragId); });
main.addEventListener("dragover", (e) => { const slot = e.target.closest("[data-slot]"); if (!slot || !dragId) return; const i = Number(slot.dataset.slot); if (eligible(byId[dragId], i) && !locked(starterAt(i))) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; slot.classList.add("drag-over"); } });
main.addEventListener("dragleave", (e) => e.target.closest("[data-slot]")?.classList.remove("drag-over"));
main.addEventListener("drop", (e) => { e.preventDefault(); const slot = e.target.closest("[data-slot]"); const id = dragId; dragId = null; if (slot && id) { if (!applyMoves([{ inId: id, i: Number(slot.dataset.slot) }])) paintHeld(null); } else paintHeld(null); });
main.addEventListener("dragend", () => { dragId = null; if (!state.carry) paintHeld(null); });
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) { closePicker(); return; }
  const choose = e.target.closest("[data-choose]");
  if (choose) { state.picker.choice = choose.dataset.choose; renderPicker(); dialog.querySelector(`[data-choose="${choose.dataset.choose}"]`)?.focus(); return; }
  const chooseSlot = e.target.closest("[data-choose-slot]");
  if (chooseSlot) { state.picker.choice = Number(chooseSlot.dataset.chooseSlot); renderPicker(); dialog.querySelector(`[data-choose-slot="${chooseSlot.dataset.chooseSlot}"]`)?.focus(); return; }
  if (e.target.closest("[data-close]")) { closePicker(); return; }
  if (e.target.closest("[data-confirm]")) confirmPicker();
});
dialog.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const radios = [...dialog.querySelectorAll('[role="radio"]:not(:disabled)')];
  const idx = radios.indexOf(document.activeElement);
  if (idx < 0) return;
  e.preventDefault();
  radios[(idx + (e.key === "ArrowDown" ? 1 : radios.length - 1)) % radios.length].click();
});
dialog.addEventListener("cancel", (e) => { e.preventDefault(); closePicker(); });
document.getElementById("sleeper-host")?.addEventListener("change", (e) => { state.sleeper = e.target.checked; starters = [...SAVED]; bench = [...SAVED_BENCH]; state.lastMove = null; state.notice = ""; state.carry = null; render(); });
document.getElementById("games-started")?.addEventListener("change", (e) => { state.live = e.target.checked; starters = [...SAVED]; bench = [...SAVED_BENCH]; state.lastMove = null; state.notice = ""; state.carry = null; render(); });
document.getElementById("show-stakes")?.addEventListener("change", (e) => { state.stakes = e.target.checked; render(); });
let narrow = phone();
addEventListener("resize", () => { if (narrow !== phone()) { narrow = phone(); render(); } });
window.__roomMock = { hold: (id) => paintHeld(id), release: () => paintHeld(state.carry), state, render };
render();
