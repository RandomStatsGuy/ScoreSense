/* Free agents flow A/B/C. Illustrative outlooks only; the preview never calls a league write endpoint. */
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const flow = document.body.dataset.flow || 'a';
  const params = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scenario = params.get('state') || 'bid';
  if (!['bid','claim','add','pre','sleeper'].includes(scenario)) scenario = 'bid';

  // Team primaries tint the headshot tile (matte mix into the surface, never a glow).
  const TEAM = { SF:'#aa0000', MIN:'#4f2683', IND:'#002c5f', SEA:'#002244', GB:'#203731', BUF:'#00338d', TEN:'#4b92db', ARI:'#97233f', NYG:'#0b2265', TB:'#d50a0a', PHI:'#004c54', NYJ:'#125740', CIN:'#fb4f14', HOU:'#03202f', DET:'#0076b6', ATL:'#a71930', PIT:'#ffb612', DEN:'#fb4f14', CAR:'#0085ca' };

  // Your roster (Bottom to Top). The weakest eligible starter is who a free agent would push out.
  const ACCEPTS = { QB:['QB'], RB:['RB'], WR:['WR'], TE:['TE'], FLEX:['RB','WR','TE'], K:['K'], DEF:['DEF'] };
  const roster = {
    starters: [
      { slot:'QB', id:'r1', sid:'6904', name:'Jalen Hurts', pos:'QB', team:'PHI', pg:20.1 },
      { slot:'RB', id:'r2', sid:'8155', name:'Breece Hall', pos:'RB', team:'NYJ', pg:15.2 },
      { slot:'RB', id:'r3', sid:'9224', name:'Chase Brown', pos:'RB', team:'CIN', pg:13.4 },
      { slot:'WR', id:'r4', sid:'7569', name:'Nico Collins', pos:'WR', team:'HOU', pg:16.8 },
      { slot:'WR', id:'r5', sid:'8148', name:'Jameson Williams', pos:'WR', team:'DET', pg:11.9 },
      { slot:'TE', id:'r6', sid:'7553', name:'Kyle Pitts', pos:'TE', team:'ATL', pg:8.1 },
      { slot:'FLEX', id:'r7', sid:'8228', name:'Jaylen Warren', pos:'RB', team:'PIT', pg:9.4 },
      { slot:'K', id:'r8', sid:'11539', name:'Jake Bates', pos:'K', team:'DET', pg:8.6 },
      { slot:'DEF', id:'r9', name:'Broncos D/ST', pos:'DEF', team:'DEN', pg:7.9 },
    ],
    bench: [
      { id:'b1', sid:'11563', name:'Bo Nix', pos:'QB', team:'DEN', pg:17.3, note:'Bye week 9' },
      { id:'b2', sid:'7090', name:'Darnell Mooney', pos:'WR', team:'NYG', pg:8.2 },
      { id:'b3', sid:'7021', name:'Rico Dowdle', pos:'RB', team:'PIT', pg:7.0 },
    ],
    openSpots: 1,
  };
  const players = [
    { id:'7049', name:'Jauan Jennings', pos:'WR', team:'MIN', pts:211, low:150, high:272, pg:12.4, bid:11 },
    { id:'9500', name:'Josh Downs', pos:'WR', team:'IND', pts:181, low:128, high:238, pg:10.6, bid:8 },
    { id:'8676', name:'Rashid Shaheed', pos:'WR', team:'SEA', pts:174, low:101, high:252, pg:10.2, bid:7 },
    { id:'9484', name:'Tucker Kraft', pos:'TE', team:'GB', pts:158, low:115, high:211, pg:9.3, bid:5 },
    { id:'8134', name:'Khalil Shakir', pos:'WR', team:'BUF', pts:169, low:121, high:217, pg:9.9, bid:6 },
    { id:'9508', name:'Tyjae Spears', pos:'RB', team:'TEN', pts:166, low:110, high:227, pg:9.8, bid:6 },
    { id:'4943', name:'Sam Darnold', pos:'QB', team:'SEA', pts:264, low:213, high:314, pg:15.5, bid:3 },
    { id:'10232', name:'Michael Wilson', pos:'WR', team:'ARI', pts:147, low:92, high:209, pg:8.6, bid:4 },
    { id:'8131', name:'Isaiah Likely', pos:'TE', team:'NYG', pts:139, low:82, high:212, pg:8.2, bid:4 },
    { id:'11618', name:'Jalen McMillan', pos:'WR', team:'TB', pts:null, low:null, high:null, pg:null, bid:null },
  ];
  const CAP = 42, PRIORITY = 4, GAMES = 17;
  const fmt1 = n => n == null ? '—' : n.toFixed(1);
  const signed = n => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
  const surname = name => name.split(' ').slice(-1)[0];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  // Comparison: the weakest starter the player could replace, or (B) the spot you are shopping for.
  const eligibleStarters = pos => roster.starters.filter(s => ACCEPTS[s.slot].includes(pos));
  const weakest = pos => eligibleStarters(pos).sort((a, c) => a.pg - c.pg)[0] || null;
  let target = null; // B: a roster row id; A: a spot shortcut
  const targetRow = () => target ? [...roster.starters, ...roster.bench].find(r => r.id === target) || null : null;
  function compare(p) {
    const t = targetRow();
    const against = t && t.slot && ACCEPTS[t.slot].includes(p.pos) ? t : weakest(p.pos);
    if (!against || p.pg == null) return { against, delta: null };
    return { against, delta: Math.round((p.pg - against.pg) * 10) / 10 };
  }
  const edgeCopy = p => {
    const { against, delta } = compare(p);
    if (p.pg == null) return null; // the pace line already says the projection is unavailable
    if (!against) return { cls: '', text: 'Depth' };
    if (delta >= 1) return { cls: 'is-up', text: `${signed(delta)} over ${surname(against.name)} · ${against.slot}` };
    if (delta > 0) return { cls: '', text: `Edges ${surname(against.name)} · ${against.slot}` };
    return { cls: '', text: `Depth behind ${surname(against.name)}` };
  };
  const spotCopy = () => roster.openSpots > 0 ? `No drop · ${roster.openSpots} open spot` : `Drop ${[...roster.bench].sort((a, c) => a.pg - c.pg)[0].name}`;
  const weakSpots = () => {
    const seen = new Set(); const out = [];
    for (const s of [...roster.starters].sort((a, c) => a.pg - c.pg)) {
      if (['K','DEF'].includes(s.slot) || seen.has(s.slot)) continue;
      seen.add(s.slot); out.push(s); if (out.length === 3) break;
    }
    return out;
  };
  // How many free agents in the pool beat a starter at their slot.
  const beats = s => players.filter(p => p.pg != null && !saved.has(p.id) && ACCEPTS[s.slot].includes(p.pos) && p.pg > s.pg).length;

  // Lineup consequence: your projected lineup now, and after every pending move lands.
  const lineupNow = () => roster.starters.reduce((s, r) => s + r.pg, 0);
  function pendingSwaps() {
    const clone = roster.starters.map(r => ({ ...r }));
    const swaps = new Map(); // starter id -> incoming player
    for (const id of order) {
      const p = players.find(x => x.id === id);
      if (!p || !saved.has(id) || p.pg == null) continue;
      const out = clone.filter(s => ACCEPTS[s.slot].includes(p.pos)).sort((a, c) => a.pg - c.pg)[0];
      if (!out || p.pg <= out.pg) continue;
      swaps.set(out.id, { p, slot: out.slot, from: roster.starters.find(s => s.id === out.id) });
      Object.assign(out, { pg: p.pg, name: p.name, pos: p.pos });
    }
    const total = clone.reduce((s, r) => s + r.pg, 0);
    return { swaps, total, delta: Math.round((total - lineupNow()) * 10) / 10 };
  }
  function bestUpgrade(pool = players) {
    let best = null;
    for (const p of pool) {
      if (p.pg == null || saved.has(p.id)) continue;
      const { against, delta } = compare(p);
      if (against && delta > 0 && (!best || delta > best.delta)) best = { p, against, delta };
    }
    return best;
  }
  const landsWord = () => scenario === 'bid' ? 'if the bid wins' : scenario === 'claim' ? 'if the claim clears' : 'now';
  const landsAll = () => scenario === 'bid' ? 'if every bid wins' : scenario === 'claim' ? 'if every claim clears' : 'now';

  // Preview state
  let position = 'ALL', sort = scenario === 'bid' ? 'bid' : 'pg', query = '', watchedOnly = false;
  const watched = new Set();
  const saved = new Map(); // id -> { amount, ceiling, drop, order }
  let last = null; // A/B status line { id, text }
  let order = [];  // C slip order
  let justSaved = null, lastListKey = '';
  const dialog = $('#fa-dialog');
  let returnFocus = null, selected = null;

  const caret = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const icon = kind => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${kind === 'close' ? '<path d="m6 6 12 12M18 6 6 18"/>' : kind === 'filter' ? '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--bg-base)"/><circle cx="15" cy="17" r="3" fill="var(--bg-base)"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'}</svg>`;
  const face = p => `<span class="fa-face" style="--team:${TEAM[p.team] || 'var(--surface-raised)'}"><span aria-hidden="true">${p.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span>${p.sid || /^\d+$/.test(p.id) ? `<img src="https://sleepercdn.com/content/nfl/players/thumb/${p.sid || p.id}.jpg" width="96" height="96" alt="" loading="lazy">` : ''}</span>`;
  // Floor–ceiling band with a tick where your starter sits; the part of the range that beats them is amber.
  const band = (p, against) => {
    if (p.pts == null) return '';
    const tick = against && scenario !== 'pre' ? Math.min(99, against.pg * GAMES / 3.5) : null;
    const beatFrom = tick != null ? Math.max(p.low / 3.5, tick) : null;
    return `<div class="fa-range-track${tick != null ? ' has-tick' : ''}" style="--low:${p.low / 3.5}%;--high:${p.high / 3.5}%;--median:${p.pts / 3.5}%${tick != null ? `;--tick:${tick}%;--beat:${beatFrom}%` : ''}" aria-hidden="true">${tick != null ? (beatFrom < p.high / 3.5 ? '<i class="fa-beat"></i>' : '') + '<i class="fa-tick"></i>' : ''}</div>`;
  };
  const actionWord = () => scenario === 'claim' ? 'Claim' : scenario === 'bid' ? 'Bid' : 'Add';
  const eligibleForTarget = p => { const t = targetRow(); return !t || !t.slot || ACCEPTS[t.slot].includes(p.pos); };
  const sorted = () => players
    .filter(p => (position === 'ALL' || p.pos === position) && eligibleForTarget(p) && (!query || `${p.name} ${p.team}`.toLowerCase().includes(query.toLowerCase())) && (!watchedOnly || watched.has(p.id)))
    .sort((a, c) => {
      if (sort === 'edge') return (compare(c).delta ?? -99) - (compare(a).delta ?? -99);
      return (c[sort] ?? -1) - (a[sort] ?? -1);
    });
  function toast(text) { const t = $('#preview-toast'); t.textContent = text; t.hidden = false; clearTimeout(window.faToastTimer); window.faToastTimer = setTimeout(() => t.hidden = true, 3500); }
  function onImages() { $$('img').forEach(img => img.addEventListener('error', () => img.hidden = true, { once: true })); }
  function menu(id, label, items, value) { return `<details class="fa-menu" id="${id}"><summary><span><small>${label}</small><strong>${items.find(x => x[0] === value)[1]}</strong>${caret}</span></summary><div class="fa-menu-options" role="radiogroup" aria-label="${label}">${items.map(([key, text]) => `<button type="button" role="radio" aria-checked="${key === value}" data-${id}="${key}">${text}</button>`).join('')}</div></details>`; }

  // Numbers that change count to their new value (skipped under reduced motion).
  const counters = new Map();
  function countUp() {
    $$('[data-count]').forEach(el => {
      const key = el.dataset.count, to = Number(el.dataset.to), decimals = Number(el.dataset.decimals ?? 1), sign = 'sign' in el.dataset;
      const show = v => el.textContent = (sign ? signed(v) : v.toFixed(decimals));
      const from = counters.has(key) ? counters.get(key) : to; counters.set(key, to);
      if (reduced || from === to) { show(to); return; }
      const t0 = performance.now(), dur = 560;
      const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); show(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  const num = (key, value, { decimals = 1, sign = false } = {}) => `<span data-count="${key}" data-to="${value}" data-decimals="${decimals}"${sign ? ' data-sign' : ''}>${sign ? signed(value) : value.toFixed(decimals)}</span>`;

  const committed = () => [...saved.values()].reduce((s, v) => s + (v.amount || 0), 0);
  const windowCopy = () => ({
    bid: ['Bids close Wednesday', `12:00 PM ET · $${CAP - committed()} available cap${committed() ? ` after $${committed()} in bids` : ''}`],
    claim: ['Waivers run Wednesday', `12:00 PM ET · Your priority: ${PRIORITY}`],
    add: ['Free agency is open', `Adds take effect now · ${roster.openSpots} open spot`],
    pre: ['Adds open after the draft', 'Star players for draft night'],
    sleeper: ['Sleeper owns adds in this league', 'Outlooks here, moves in Sleeper'],
  })[scenario];

  function renderWindow() {
    const [title, support] = windowCopy();
    $('#fa-window').innerHTML = `<div class="fa-window-copy" id="fa-window-reason"><strong>${title}</strong><span>${support}${scenario === 'sleeper' ? ' · <a href="#" data-preview="Sleeper · set roster">Open Sleeper ↗</a>' : ''}</span></div><button class="fa-icon" type="button" id="fa-how" aria-label="How adds work">${icon('info')}</button>`;
  }
  function renderStatus() {
    const el = $('#fa-status');
    if (!el) return;
    if (!last) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.className = `fa-status${last.saved ? ' is-saved' : ''}`;
    el.innerHTML = `${last.saved ? '<span class="fa-kicker">Saved</span>' : ''}<span>${last.text}</span><button type="button" class="btn-link" id="fa-undo">Undo</button>`;
    $('#fa-undo').onclick = () => { saved.delete(last.id); order = order.filter(x => x !== last.id); const name = players.find(p => p.id === last.id).name; last = { id: null, saved: false, text: `Undone. ${name} is back in the pool with no ${scenario === 'claim' ? 'claim' : scenario === 'bid' ? 'bid' : 'add'}.`, undone: true }; render(); };
    if (last.undone) { $('#fa-undo').hidden = true; }
  }

  // The scoreboard: your lineup per game, what the pending moves do to it, and the best upgrade left in the pool.
  function boardCopy() {
    const t = targetRow();
    const pending = pendingSwaps();
    const now = lineupNow();
    if (pending.swaps.size) {
      const lines = [...pending.swaps.values()].map(({ p, slot, from }) => `${surname(p.name)} in at ${slot}, ${surname(from.name)} to the bench`);
      return { now, after: pending.total, delta: pending.delta, label: landsAll(), verdict: `${lines.join(' · ')}.`, cls: pending.delta >= 1 ? 'is-up' : '' };
    }
    const pool = t && t.slot ? players.filter(p => ACCEPTS[t.slot].includes(p.pos)) : players;
    const best = bestUpgrade(pool);
    if (t && t.slot) {
      const n = beats(t);
      return { now, after: null, delta: best ? best.delta : 0, label: `best at ${t.slot}`, cls: best && best.delta >= 1 ? 'is-up' : '',
        verdict: n ? `${n} free agent${n === 1 ? '' : 's'} beat ${surname(t.name)} (${fmt1(t.pg)} / game). ${surname(best.p.name)} gains the most.` : `Nobody in the pool beats ${surname(t.name)} at ${t.slot} right now.` };
    }
    if (!best) return { now, after: null, delta: 0, label: 'no upgrade', verdict: 'Nobody in the pool beats a starter right now.', cls: '' };
    const hint = flow === 'a' ? `Tap ${best.against.slot} to shop the spot.` : flow === 'b' ? `Tap ${surname(best.against.name)} to shop the spot.` : 'Bid from the row and it lands on your slip.';
    return { now, after: null, delta: best.delta, label: 'best upgrade', cls: best.delta >= 1 ? 'is-up' : '', verdict: `${best.p.name} over ${surname(best.against.name)} at ${best.against.slot}. ${hint}` };
  }
  function renderBoard() {
    const host = $('#fa-board'); if (!host) return;
    if (['pre'].includes(scenario)) { host.hidden = true; return; }
    host.hidden = false;
    const b = boardCopy();
    host.className = `fa-board${b.cls ? ' ' + b.cls : ''}`;
    host.innerHTML = `<div class="fa-board-now"><small>Your lineup</small><strong>${num('lineup', b.after ?? b.now)}<span class="fa-unit"> / game</span></strong>${b.after ? `<small class="fa-board-from">was ${fmt1(b.now)}</small>` : ''}</div>
      <div class="fa-board-delta"><strong>${num('delta', b.delta, { sign: true })}</strong><small>${b.label}</small></div>
      <p class="fa-board-verdict">${b.verdict}</p>`;
  }

  // A · weak-spot shortcuts
  function renderSpots() {
    const host = $('#fa-spots'); if (!host) return;
    if (scenario === 'pre') { host.hidden = true; return; }
    host.hidden = false;
    const spots = weakSpots();
    host.innerHTML = `<button type="button" class="fa-spot" aria-pressed="${!target}" data-spot=""><small>Pool</small><strong>All players</strong></button>`
      + spots.map(s => { const n = beats(s); return `<button type="button" class="fa-spot${n ? ' has-upgrades' : ''}" aria-pressed="${target === s.id}" data-spot="${s.id}" aria-label="Shop for ${s.slot}: ${s.name}, ${fmt1(s.pg)} per game${n ? `, ${n} free agents beat him` : ''}"><small>${s.slot}</small><strong>${surname(s.name)} · ${fmt1(s.pg)}</strong><em>${n ? `${n} beat him` : 'No upgrade'}</em></button>`; }).join('')
      + (roster.openSpots ? `<button type="button" class="fa-spot is-open" aria-pressed="${target === 'open'}" data-spot="open"><small>Bench</small><strong>${roster.openSpots} open spot</strong><em>No drop</em></button>` : '');
    $$('[data-spot]').forEach(el => el.onclick = () => { target = el.dataset.spot || null; position = 'ALL'; sort = target && target !== 'open' ? 'edge' : (scenario === 'bid' ? 'bid' : 'pg'); render(); $(`[data-spot="${el.dataset.spot}"]`).focus(); });
  }
  // B · roster column (desktop) and tile rail (phone)
  function renderRoster() {
    const host = $('#fa-roster'); const rail = $('#fa-rail'); if (!host) return;
    const t = targetRow();
    const { swaps } = pendingSwaps();
    const row = (r, open) => {
      if (open) return `<button type="button" class="fa-roster-row is-open" aria-pressed="${target === 'open'}" data-target="open"><small>BN</small><span class="fa-roster-name"><strong>Open spot</strong><span>No drop needed</span></span><b>—</b></button>`;
      const sw = swaps.get(r.id); const n = r.slot && !['K','DEF'].includes(r.slot) ? beats(r) : 0;
      return `<button type="button" class="fa-roster-row${r.slot && weakSpots().includes(r) ? ' is-weak' : ''}${sw ? ' is-swapping' : ''}" aria-pressed="${target === r.id}" data-target="${r.id}"><small>${r.slot || 'BN'}</small><span class="fa-roster-name"><strong>${r.name}</strong><span>${sw ? `<em>${surname(sw.p.name)} in ${landsWord()}</em>` : `${r.pos} · ${r.team}${r.note ? ' · ' + r.note : ''}${n ? ` · <em>${n} beat him</em>` : ''}`}</span></span><b>${sw ? `<s>${fmt1(r.pg)}</s> ${fmt1(sw.p.pg)}` : fmt1(r.pg)}</b></button>`;
    };
    host.innerHTML = `<div class="fa-roster-head"><h2>Your roster</h2>${target ? '<button type="button" class="btn-link" data-target="">Show all players</button>' : `<span>${fmt1(lineupNow())} / game</span>`}</div>
      <p class="fa-roster-shopping">${t ? `Shopping for <strong>${t.slot || 'BN'} · ${surname(t.name)}</strong> — the pool shows ${t.slot ? ACCEPTS[t.slot].join('/') : 'every'} option and the change if they start instead.` : target === 'open' ? 'Shopping for an <strong>open bench spot</strong> — no drop needed.' : 'Tap a spot to shop for it. Amber dots mark your weakest starters.'}</p>
      <div class="fa-roster-list">${roster.starters.map(r => row(r)).join('')}<p class="fa-roster-divider">Bench</p>${roster.bench.map(r => row(r)).join('')}${roster.openSpots ? row(null, true) : ''}</div>`;
    if (rail) rail.innerHTML = roster.starters.filter(r => !['K','DEF'].includes(r.slot)).map(r => { const sw = swaps.get(r.id); const n = beats(r); return `<button type="button" class="fa-tile${weakSpots().includes(r) ? ' is-weak' : ''}${sw ? ' is-swapping' : ''}" aria-pressed="${target === r.id}" data-target="${r.id}" aria-label="Shop for ${r.slot}: ${r.name}, ${fmt1(r.pg)} projected per game${n ? `, ${n} free agents beat him` : ''}"><small>${r.slot}</small><strong>${sw ? surname(sw.p.name) : surname(r.name)}</strong><b>${sw ? `<s>${fmt1(r.pg)}</s> ${fmt1(sw.p.pg)}` : `${fmt1(r.pg)} / g`}${n && !sw ? `<em> · ${n} beat</em>` : ''}</b></button>`; }).join('')
      + (roster.openSpots ? `<button type="button" class="fa-tile is-open" aria-pressed="${target === 'open'}" data-target="open"><small>BN</small><strong>Open spot</strong><b>No drop</b></button>` : '')
      + (target ? `<button type="button" class="fa-tile" data-target=""><small>Pool</small><strong>All players</strong><b>Clear spot</b></button>` : '');
    rail?.querySelector('.fa-tile[aria-pressed=true]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    $$('[data-target]').forEach(el => el.onclick = () => { target = el.dataset.target || null; position = 'ALL'; sort = target && target !== 'open' ? 'edge' : (scenario === 'bid' ? 'bid' : 'pg'); render(); ($(`.fa-roster-row[data-target="${el.dataset.target}"]`) || $(`[data-target="${el.dataset.target}"]`))?.focus(); });
  }
  // C · slip
  function slipLines() { return order.map(id => ({ p: players.find(x => x.id === id), v: saved.get(id) })).filter(x => x.v); }
  function slipBoard(lines) {
    const pending = pendingSwaps();
    if (!lines.length) {
      const best = bestUpgrade();
      return best ? `<div class="fa-slip-board"><div class="fa-board-delta ${best.delta >= 1 ? 'is-up' : ''}"><strong>${signed(best.delta)}</strong><small>best upgrade</small></div><p>${best.p.name} over ${surname(best.against.name)} at ${best.against.slot}. Lineup ${fmt1(lineupNow())} / game today.</p></div>` : '';
    }
    const who = [...pending.swaps.values()].map(({ p, slot, from }) => `${surname(p.name)} for ${surname(from.name)} at ${slot}`);
    return `<div class="fa-slip-board${pending.delta >= 1 ? ' is-up' : ''}"><div class="fa-board-delta"><strong>${num('slipdelta', pending.delta, { sign: true })}</strong><small>/ game ${landsAll()}</small></div><p>Lineup ${fmt1(lineupNow())} → <strong>${num('slipafter', pending.total)}</strong>${who.length ? ` · ${who.join(' · ')}` : ' · depth only, no starter changes'}.</p></div>`;
  }
  function renderSlipInto(host, compact) {
    const lines = slipLines();
    const title = scenario === 'claim' ? 'Wednesday slip · claims in order' : scenario === 'bid' ? 'Wednesday slip · bids' : 'Today';
    const empty = scenario === 'claim' ? 'No claims yet. Claim beside a free agent and it lands here in order.' : scenario === 'bid' ? 'No bids yet. Bid beside a free agent; each bid saves on its own.' : 'Adds take effect right away. Undo stays here until you leave.';
    host.innerHTML = `<div class="fa-slip-head"><h2>${title}</h2><span>${scenario === 'claim' ? `Priority ${PRIORITY}` : scenario === 'bid' ? 'Runs 12:00 PM ET' : `${roster.openSpots} open spot`}</span></div>`
      + slipBoard(lines)
      + (lines.length ? `<ol class="fa-slip-lines">${lines.map(({ p, v }, i) => `<li class="fa-slip-line${justSaved === p.id ? ' is-new' : ''}"><div>${scenario === 'claim' ? `<strong><span class="fa-slip-order">${i + 1}.</span> ${p.name}</strong>` : `<strong>${p.name}</strong>`}<span>${p.pos} · ${p.team} · ${v.drop}</span></div>
          ${scenario === 'bid' ? `<div class="fa-slip-amount"><button type="button" class="fa-slip-step" data-step="${p.id}:-1" aria-label="Lower bid for ${p.name}">−</button><b>$${v.amount}</b><button type="button" class="fa-slip-step" data-step="${p.id}:1" aria-label="Raise bid for ${p.name}">+</button></div>` : scenario === 'claim' ? `<div class="fa-slip-amount"><button type="button" class="fa-slip-move" data-move="${p.id}:-1" aria-label="Move ${p.name} up" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="fa-slip-move" data-move="${p.id}:1" aria-label="Move ${p.name} down" ${i === lines.length - 1 ? 'disabled' : ''}>↓</button></div>` : '<span class="fa-edge is-open">Added</span>'}
          <div class="fa-slip-tools">${scenario === 'bid' ? `<span class="fa-cap-after">Walk-away $${v.ceiling}${v.amount > v.ceiling ? ' · <b class="is-caution">above</b>' : ''}</span>` : '<span></span>'}<button type="button" class="btn-link" data-remove="${p.id}">${scenario === 'add' ? 'Undo add' : 'Remove'}</button></div></li>`).join('')}</ol>`
        : `<p class="fa-slip-empty">${empty}</p>`)
      + (scenario === 'bid' ? `<div class="fa-slip-total"><strong>$${num('capleft', CAP - committed(), { decimals: 0 })} <span>left ${landsAll()}</span></strong><div class="fa-gauge" role="img" aria-label="$${committed()} of $${CAP} committed"><i style="--fill:${committed() / CAP * 100}%"></i></div><span>$${committed()} across ${lines.length} bid${lines.length === 1 ? '' : 's'} · $${CAP} available cap</span></div>` : scenario === 'claim' && lines.length ? `<div class="fa-slip-total"><span>A successful claim moves you to the end of priority. Drops happen only if the claim succeeds.</span></div>` : '');
    $$('[data-step]').forEach(el => el.onclick = () => { const [id, d] = el.dataset.step.split(':'); const v = saved.get(id); v.amount = Math.max(1, Math.min(CAP, v.amount + Number(d))); render(); ($(`[data-step="${el.dataset.step}"]`) || $('#fa-rack'))?.focus(); });
    $$('[data-move]').forEach(el => el.onclick = () => { const [id, d] = el.dataset.move.split(':'); const i = order.indexOf(id); const j = i + Number(d); if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; render(); $(`[data-move="${el.dataset.move}"]`)?.focus(); });
    $$('[data-remove]').forEach(el => el.onclick = () => { const id = el.dataset.remove; saved.delete(id); order = order.filter(x => x !== id); render(); if (compact && dialog.open) openRack(); });
  }
  function renderSlip() {
    const host = $('#fa-slip'); if (!host) return;
    if (['pre','sleeper'].includes(scenario)) { host.hidden = true; $('#fa-rack').hidden = true; return; }
    host.hidden = false; renderSlipInto(host, false);
    const rack = $('#fa-rack'); rack.hidden = false;
    const lines = slipLines();
    const pending = pendingSwaps();
    const gain = lines.length && pending.delta ? `<b class="${pending.delta >= 1 ? 'is-up' : ''}">${signed(pending.delta)} / game</b> ${landsAll()}` : '';
    rack.innerHTML = `<div><strong>${scenario === 'claim' ? `${lines.length} claim${lines.length === 1 ? '' : 's'} in order` : scenario === 'bid' ? `${lines.length} bid${lines.length === 1 ? '' : 's'} · $${committed()} committed` : `${lines.length} added today`}</strong><span>${gain || (scenario === 'bid' ? `$${CAP - committed()} left if every bid wins · runs Wed 12:00 PM ET` : scenario === 'claim' ? `Priority ${PRIORITY} · runs Wed 12:00 PM ET` : 'Undo stays here until you leave')}</span></div><span class="control-caret" aria-hidden="true">${caret}</span>`;
    rack.setAttribute('aria-label', `Open the ${scenario === 'add' ? 'adds' : 'Wednesday slip'}`);
    rack.onclick = openRack;
  }
  function openRack() { show(scenario === 'claim' ? 'Wednesday slip' : scenario === 'bid' ? 'Wednesday slip' : 'Added today', '<section class="fa-slip" id="fa-slip-sheet"></section>'); renderSlipInto($('#fa-slip-sheet'), true); countUp(); returnFocus = $('#fa-rack'); }

  function actionCell(p) {
    const inSlip = saved.has(p.id);
    if (scenario === 'sleeper') return `<a class="fa-sleeper" href="#" data-preview="Sleeper · ${p.name}">Open in Sleeper <span aria-hidden="true">↗</span></a>`;
    if (scenario === 'pre') return `<button type="button" class="fa-acquire fa-draft-star" data-star="${p.id}" aria-pressed="${watched.has(p.id)}" aria-label="Star ${p.name} for draft">${watched.has(p.id) ? '★ Starred' : '☆ Star'}</button><button type="button" class="fa-acquire" disabled aria-describedby="fa-window-reason">Add</button>`;
    if (flow === 'c') {
      if (inSlip) return `<button type="button" class="fa-acquire is-in" data-edit="${p.id}" aria-label="${scenario === 'bid' ? `Bid $${saved.get(p.id).amount} in · edit ${p.name}` : `${scenario === 'claim' ? 'Claim' : 'Added'} · edit ${p.name}`}">${scenario === 'bid' ? `$${saved.get(p.id).amount} in` : scenario === 'claim' ? `Claim ${order.indexOf(p.id) + 1}` : 'Added'}</button>`;
      if (scenario === 'bid') return p.bid == null
        ? `<button type="button" class="fa-acquire" data-action="${p.id}" aria-label="Bid on ${p.name}">Bid</button>`
        : `<button type="button" class="fa-acquire" data-inline="${p.id}" aria-label="Bid $${p.bid} on ${p.name}">Bid $${p.bid}</button>`;
      return `<button type="button" class="fa-acquire" data-inline="${p.id}" aria-label="${actionWord()} ${p.name}">${actionWord()}</button>`;
    }
    return `<button type="button" class="fa-acquire${inSlip ? ' is-saved' : ''}" data-action="${p.id}" ${inSlip ? 'disabled' : ''} aria-label="${inSlip ? '' : actionWord() + ' '}${p.name}${inSlip ? ' · ' + (scenario === 'bid' ? 'bid in' : scenario === 'claim' ? 'claimed' : 'added') : ''}">${inSlip ? (scenario === 'bid' ? 'Bid in' : scenario === 'claim' ? 'Claimed' : 'Added') : actionWord()}</button>`;
  }

  function render() {
    document.body.dataset.state = scenario;
    $$('[data-scenario]').forEach(el => el.setAttribute('aria-checked', el.dataset.scenario === scenario));
    renderWindow(); renderSpots(); renderBoard(); renderRoster(); renderSlip(); renderStatus();
    const t = targetRow();
    const sortItems = [['pg', 'Proj / game'], ['pts', 'Season pts'], ['high', 'Ceiling'], ['low', 'Floor'], ...(scenario === 'bid' ? [['bid', 'Bid value']] : []), ...(t ? [['edge', `vs ${surname(t.name)}`]] : [])];
    const posItems = t && t.slot ? [['ALL', ACCEPTS[t.slot].join('/')], ...ACCEPTS[t.slot].map(x => [x, x])] : [['ALL', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']];
    if (!posItems.some(x => x[0] === position)) position = 'ALL';
    if (!sortItems.some(x => x[0] === sort)) sort = 'pg';
    $('#fa-toolbar').innerHTML = menu('position', 'Pos', posItems, position) + menu('sort', 'Sort', sortItems, sort) + `<button class="fa-icon" id="fa-filters" type="button" aria-label="Search and filters">${icon('filter')}</button>`;
    const list = sorted();
    $('#fa-count').textContent = `${list.length} players${query ? ' · ' + query : ''}${watchedOnly ? ' · Starred' : ''}${t ? ` · fit ${t.slot || 'BN'}` : target === 'open' ? ' · open spot' : ''}`;
    $('#fa-scoring').textContent = scenario === 'bid' ? 'Full-season outlook · PPR · Balanced bids' : 'Full-season outlook · PPR';
    // Rows animate in only when the list itself changed (filter, sort, spot, scenario) — not on every save.
    const listKey = [scenario, target, position, sort, query, watchedOnly].join('|');
    const fresh = listKey !== lastListKey; lastListKey = listKey;
    $('#fa-pool').classList.toggle('is-fresh', fresh);
    const best = scenario !== 'pre' && scenario !== 'sleeper' ? bestUpgrade(list) : null;
    let section = null, html = '';
    list.forEach((p, i) => {
      const edge = edgeCopy(p); const { against, delta } = compare(p);
      if (sort === 'edge' && t) { // group: who beats your starter, then depth
        const group = delta != null && delta > 0 ? `${beats(t)} beat ${surname(t.name)} at ${t.slot}` : 'Depth';
        if (group !== section) { section = group; html += `<p class="fa-group${group === 'Depth' ? '' : ' is-up'}">${group}</p>`; }
      }
      const tag = best && best.p.id === p.id && best.delta >= 1 ? `<span class="fa-tag">Best upgrade</span>` : '';
      html += `<article class="fa-player${saved.has(p.id) && flow === 'c' ? ' is-in' : ''}${scenario === 'pre' ? ' is-locked' : ''}${justSaved === p.id ? ' is-just-saved' : ''}" data-player="${p.id}" style="--i:${Math.min(i, 8)}"><div class="fa-player-top"><button type="button" class="fa-profile" data-profile="${p.id}" aria-label="Open ${p.name} details">${face(p)}<span class="fa-name"><strong>${p.name}${tag}</strong><span>${p.pos} · ${p.team}</span><span>${p.pg == null ? 'Projection unavailable' : `${fmt1(p.pg)} proj / game`}</span>${edge && scenario !== 'pre' && (flow !== 'b' || !t) ? `<span class="fa-edge ${edge.cls}">${edge.text}</span>` : ''}</span></button>
        <div class="fa-outlook">${flow === 'b' && t && scenario !== 'pre' ? `<strong class="${delta != null && delta >= 1 ? 'is-up' : ''}">${delta == null ? '—' : signed(delta)}</strong><small>vs ${surname(t.name)} / game</small>` : `<strong>${p.pts ?? '—'}</strong><small>Full-season pts</small>`}</div></div>
        <div class="fa-player-bottom"><div class="fa-range"><div class="fa-range-copy">${p.pts == null ? '<span>Range unavailable</span>' : `<span>${p.low}–${p.high} range${against && scenario !== 'pre' ? ` · <i class="fa-tick-key">${surname(against.name)} ${Math.round(against.pg * GAMES)}</i>` : ''}</span>`}${scenario === 'bid' && p.bid != null ? `<strong>$${p.bid} suggested</strong>` : ''}</div>${band(p, against)}</div>${flow === 'c' ? `<span class="fa-inline">${actionCell(p)}</span>` : actionCell(p)}</div></article>`;
    });
    $('#fa-pool').innerHTML = list.length ? html : `<div class="fa-empty"><p>No players match these filters.</p><button type="button" class="btn btn-ghost" id="fa-reset">Reset filters</button></div>`;
    justSaved = null;

    $('#fa-how').onclick = openHow;
    $('#fa-filters').onclick = openFilters;
    $$('[data-position]').forEach(el => el.onclick = () => { position = el.dataset.position; render(); $('#position summary').focus(); });
    $$('[data-sort]').forEach(el => el.onclick = () => { sort = el.dataset.sort; render(); $('#sort summary').focus(); });
    $$('[data-profile]').forEach(el => el.onclick = () => openPlayer(el.dataset.profile, el));
    $$('[data-action]').forEach(el => el.onclick = () => openPlayer(el.dataset.action, el));
    $$('[data-edit]').forEach(el => el.onclick = () => openPlayer(el.dataset.edit, el));
    $$('[data-inline]').forEach(el => el.onclick = () => { const p = players.find(x => x.id === el.dataset.inline); commit(p, { amount: p.bid, ceiling: p.bid, drop: spotCopy() }); $(`[data-edit="${p.id}"]`)?.focus(); });
    $$('[data-star]').forEach(el => el.onclick = () => { const id = el.dataset.star; watched.has(id) ? watched.delete(id) : watched.add(id); render(); $(`[data-star="${id}"]`).focus(); });
    if ($('#fa-reset')) $('#fa-reset').onclick = () => { position = 'ALL'; query = ''; watchedOnly = false; target = null; render(); };
    onImages(); countUp();
  }

  function commit(p, v) {
    saved.set(p.id, v); if (!order.includes(p.id)) order.push(p.id);
    justSaved = p.id;
    const { against, delta } = compare(p);
    const gain = against && delta > 0 ? ` ${signed(delta)} / game at ${against.slot} ${landsWord()}.` : '';
    if (flow !== 'c') last = { id: p.id, saved: true, text: scenario === 'bid' ? `Bid $${v.amount} on ${p.name}. Walk-away $${v.ceiling}. ${v.drop}.${gain}` : scenario === 'claim' ? `Claim ${order.length} on ${p.name}. ${v.drop}.${gain}` : `${p.name} added. ${v.drop === 'No drop · 1 open spot' ? 'Your open spot is filled.' : v.drop + '.'}${gain}` };
    render();
    if (flow !== 'c') { const s = $('#fa-status'); s.focus(); }
    else toast(scenario === 'bid' ? `Preview: bid $${v.amount} on ${p.name} saved to the slip. No league changes.` : scenario === 'claim' ? `Preview: ${p.name} is claim ${order.length}. No league changes.` : `Preview: ${p.name} added. No league changes.`);
  }

  function show(title, content, footer = '') {
    returnFocus = document.activeElement;
    dialog.innerHTML = `<header class="fa-dialog-head"><h2 id="fa-dialog-title">${title}</h2><button class="fa-icon" type="button" id="fa-close" aria-label="Close">${icon('close')}</button></header><div class="fa-dialog-content">${content}</div>${footer ? `<footer class="fa-dialog-footer">${footer}</footer>` : ''}`;
    $('#fa-close').onclick = () => dialog.close(); dialog.showModal(); onImages();
  }
  // The duel: incoming beside the starter they push out, the per-game change in the middle, the lineup line under it.
  function versus(p) {
    const { against, delta } = compare(p);
    if (!against) return '';
    const up = delta != null && delta >= 1, flat = delta != null && delta > 0 && delta < 1;
    const head = p.pg == null ? 'Projection unavailable' : up ? `${surname(p.name)} starts at ${against.slot}, ${surname(against.name)} to the bench` : flat ? `Close call at ${against.slot}` : `${surname(against.name)} keeps ${against.slot}`;
    const after = p.pg != null && delta > 0 ? lineupNow() + delta : null;
    return `<div class="fa-versus${up ? ' is-up' : ''}">
      <div class="fa-duel"><div class="fa-duel-side">${face(p)}<strong>${surname(p.name)}</strong><span>${p.pos} · ${p.team}</span><b>${fmt1(p.pg)}</b><span>proj / game</span></div>
        <div class="fa-duel-center"><strong>${delta == null ? '—' : signed(delta)}</strong><span>/ game at ${against.slot}</span></div>
        <div class="fa-duel-side is-out">${face(against)}<strong>${surname(against.name)}</strong><span>${against.pos} · ${against.team} · ${against.slot}</span><b>${fmt1(against.pg)}</b><span>proj / game</span></div></div>
      <p class="fa-duel-head">${head}</p>
      ${band(p, against)}<p class="fa-versus-note">${p.pts == null ? 'No forecast yet; the range stays blank rather than reading as zero.' : `${p.low}–${p.high} full-season range · ${p.pts} median · ${surname(against.name)} ${Math.round(against.pg * GAMES)}`}${against.note ? ` · ${surname(against.name)}: ${against.note}` : ''}</p>
      ${after ? `<p class="fa-versus-lineup">Lineup <span>${fmt1(lineupNow())}</span> → <strong>${fmt1(after)}</strong> / game ${landsWord()}</p>` : ''}</div>`;
  }
  function openPlayer(id, trigger) {
    selected = players.find(p => p.id === id); const p = selected; const existing = saved.get(id);
    const amount = existing?.amount ?? p.bid ?? '', ceiling = existing?.ceiling ?? p.bid ?? '';
    const spotField = ['bid','claim','add'].includes(scenario) ? `<div class="fa-spot-field"><span>Roster spot</span><div class="fa-choice-group" role="radiogroup" aria-label="Roster spot">${roster.openSpots ? `<button type="button" role="radio" aria-checked="true" data-drop="No drop · ${roster.openSpots} open spot">Open spot · no drop</button>` : ''}${[...roster.bench].sort((a, c) => a.pg - c.pg).slice(0, 2).map((b, i) => `<button type="button" role="radio" aria-checked="${!roster.openSpots && i === 0}" data-drop="Drop ${b.name}">Drop ${surname(b.name)} · ${fmt1(b.pg)}</button>`).join('')}</div></div>` : '';
    const acquisition = scenario === 'bid'
      ? `<p class="meta">${p.bid == null ? 'No suggested bid without a projection.' : `$${p.bid} suggested · PPR · Balanced`}</p><div class="fa-bid-fields"><label class="fa-field">Your bid ($)<input id="fa-amount" type="number" min="1" max="${CAP}" value="${amount}" inputmode="numeric"></label><label class="fa-field">Walk-away ($)<input id="fa-ceiling" type="number" min="1" value="${ceiling}" inputmode="numeric"></label></div><p id="fa-after" class="meta">If won · $${CAP - committed() - (Number(amount) || 0) + (existing?.amount || 0)} cap left before other pending bids</p><p id="fa-bid-error" class="fa-warning" role="status" hidden></p>${spotField}`
      : scenario === 'claim' ? `<p class="meta">Priority ${PRIORITY} · runs Wednesday, 12:00 PM ET${order.length && !existing ? ` · this becomes claim ${order.length + 1}` : ''}</p>${spotField}`
      : scenario === 'pre' ? '<p class="fa-warning">Adds open after the draft.</p>'
      : scenario === 'sleeper' ? '<p class="meta">Sleeper owns roster moves in this league. Compare here, then add in Sleeper.</p>'
      : `<p class="meta">Adds take effect right away.</p>${spotField}`;
    const footer = scenario === 'pre' ? `<button class="btn btn-ghost" type="button" id="fa-watch">${watched.has(p.id) ? '★ Starred for draft' : '☆ Star for draft'}</button><button class="btn btn-primary" type="button" disabled>Add player</button>`
      : scenario === 'sleeper' ? `<a class="btn btn-ghost" href="#" data-preview="Sleeper · ${p.name}">Open in Sleeper ↗</a>`
      : `${existing ? `<button class="btn btn-ghost" type="button" id="fa-remove">${scenario === 'bid' ? 'Withdraw bid' : scenario === 'claim' ? 'Cancel claim' : 'Undo add'}</button>` : ''}<button type="button" class="btn btn-primary" id="fa-submit">${existing ? (scenario === 'bid' ? 'Update bid' : scenario === 'claim' ? 'Update claim' : 'Done') : scenario === 'bid' ? 'Place bid' : scenario === 'claim' ? 'Confirm claim' : 'Add player'}</button>`;
    show('Player outlook', `<div class="fa-dialog-identity">${face(p)}<div><h3>${p.name}</h3><p class="meta">${p.pos} · ${p.team}${p.pg == null ? '' : ` · ${fmt1(p.pg)} proj / game`}</p></div></div>${versus(p)}${acquisition}<button class="fa-quiet-link" type="button" id="fa-history">${scenario === 'claim' || scenario === 'add' ? 'Player notes' : 'Contract history'} <span aria-hidden="true">↗</span></button>`, footer);
    returnFocus = trigger;
    $('#fa-history').onclick = () => toast('Preview: player details. Sample data; no league changes.');
    if ($('#fa-watch')) $('#fa-watch').onclick = () => { watched.has(p.id) ? watched.delete(p.id) : watched.add(p.id); $('#fa-watch').textContent = watched.has(p.id) ? '★ Starred for draft' : '☆ Star for draft'; render(); };
    $$('[data-drop]').forEach(el => el.onclick = () => $$('[data-drop]').forEach(x => x.setAttribute('aria-checked', x === el)));
    if ($('#fa-remove')) $('#fa-remove').onclick = () => { saved.delete(p.id); order = order.filter(x => x !== p.id); dialog.close(); last = flow === 'c' ? null : { id: null, saved: false, text: `${p.name} is back in the pool.`, undone: true }; render(); };
    if ($('#fa-submit')) $('#fa-submit').onclick = () => { const drop = $('[data-drop][aria-checked=true]')?.dataset.drop || spotCopy(); dialog.close(); commit(p, { amount: scenario === 'bid' ? Number($('#fa-amount').value) : null, ceiling: scenario === 'bid' ? Number($('#fa-ceiling').value) : null, drop }); };
    if (scenario === 'bid') {
      const validate = () => { const a = Number($('#fa-amount').value), c = Number($('#fa-ceiling').value); const left = CAP - committed() + (existing?.amount || 0); const message = a < 1 || c < 1 ? 'Enter an amount of at least $1.' : a > left ? `This bid exceeds your $${left} available cap.` : a > c ? 'Above your walk-away. Lower the bid or raise your limit.' : ''; $('#fa-bid-error').textContent = message; $('#fa-bid-error').hidden = !message; $('#fa-submit').disabled = !!message; $('#fa-after').textContent = `If won · $${left - a} cap left before other pending bids`; };
      $('#fa-amount').oninput = validate; $('#fa-ceiling').oninput = validate; validate();
    }
  }
  function openHow() {
    show('How adds work', `<p class="muted">${scenario === 'bid' ? 'The highest bid wins when this window processes. Each bid saves on its own; your walk-away is a personal limit, saved only on this device.' : scenario === 'claim' ? 'Claims run in your chosen order. A successful claim moves your team to the end of priority. A conditional drop happens only if the claim succeeds.' : scenario === 'pre' ? 'Adds open after the draft. Stars keep players on your draft watchlist.' : scenario === 'sleeper' ? 'This league is linked to Sleeper, which owns roster moves. ScoreSense shows outlooks and the change to your lineup; adds happen in Sleeper and sync back within a minute.' : 'Adds take effect immediately during free agency.'}</p><p class="meta">The amber part of each range bar is where a player beats the starter he would replace. All player outlooks and league dates in this mock are illustrative.</p>`);
  }
  function openFilters() {
    let pendingWatched = watchedOnly;
    show('Search & filters', `<label class="fa-field">Search players<input id="fa-query" type="search" placeholder="Name or team" value="${esc(query)}"></label>${scenario === 'pre' ? `<button class="fa-acquire" type="button" id="fa-watch-only" aria-pressed="${watchedOnly}">Starred for draft only</button>` : ''}`, '<button class="btn btn-ghost" type="button" id="fa-clear">Reset</button><button class="btn btn-primary" type="button" id="fa-apply">Show players</button>');
    if ($('#fa-watch-only')) $('#fa-watch-only').onclick = () => { pendingWatched = !pendingWatched; $('#fa-watch-only').setAttribute('aria-pressed', pendingWatched); };
    $('#fa-clear').onclick = () => { pendingWatched = false; $('#fa-query').value = ''; if ($('#fa-watch-only')) $('#fa-watch-only').setAttribute('aria-pressed', 'false'); };
    $('#fa-apply').onclick = () => { query = $('#fa-query').value; watchedOnly = pendingWatched; dialog.close(); render(); $('#fa-filters').focus(); };
    $('#fa-query').focus();
  }
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); else if (selected) $(`[data-profile="${selected.id}"]`)?.focus(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dialog.open) $$('.fa-menu[open]').forEach(el => { el.open = false; el.querySelector('summary').focus(); }); });
  document.addEventListener('click', e => $$('.fa-menu[open]').forEach(el => { if (!el.contains(e.target)) el.open = false; }));
  $$('[data-scenario]').forEach(el => el.onclick = () => { scenario = el.dataset.scenario; sort = scenario === 'bid' ? 'bid' : 'pg'; saved.clear(); order = []; last = null; target = null; counters.clear(); render(); });
  if (params.has('long')) {
    players[0].name = 'Marquez Valdes-Scantling';
    $$('.phone-league span:first-child').forEach(el => el.textContent = 'The Very Long Championship League');
    $$('.phone-league').forEach(el => el.setAttribute('aria-label', 'The Very Long Championship League · switch league'));
  }
  if (params.has('target')) target = params.get('target');
  if (params.has('target') && target !== 'open') sort = 'edge';
  if (params.has('seed')) { // pre-filled slip / saved state for screenshots
    const seeds = { bid: [['9500', 8, 10], ['9484', 5, 6]], claim: [['9500'], ['9484']], add: [['9484']] }[scenario] || [];
    seeds.forEach(([id, amount, ceiling]) => { saved.set(id, { amount: amount ?? null, ceiling: ceiling ?? null, drop: spotCopy() }); order.push(id); });
    if (flow !== 'c' && seeds.length) { const p = players.find(x => x.id === seeds[0][0]); const v = saved.get(p.id); const { against, delta } = compare(p); const gain = against && delta > 0 ? ` ${signed(delta)} / game at ${against.slot} ${landsWord()}.` : ''; last = { id: p.id, saved: true, text: scenario === 'bid' ? `Bid $${v.amount} on ${p.name}. Walk-away $${v.ceiling}. ${v.drop}.${gain}` : scenario === 'claim' ? `Claim 1 on ${p.name}. ${v.drop}.${gain}` : `${p.name} added. Your open spot is filled.${gain}` }; }
  }
  render();
})();
