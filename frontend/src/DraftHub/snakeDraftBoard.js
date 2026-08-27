/** Pure helpers for snake / linear pick-draft boards. Stable team columns. */

export function isPickDraftType(draftType) {
  const t = String(draftType || "").toLowerCase();
  return t === "snake" || t === "linear" || t === "serpentine" || t === "straight";
}

export function normalizeDraftType(draftType) {
  const t = String(draftType || "").toLowerCase();
  if (t === "linear" || t === "straight") return "linear";
  if (t === "snake" || t === "serpentine") return "snake";
  return "auction";
}

export function abbreviateTeamName(name, fallback = "Team") {
  const raw = String(name || "").trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (raw.length <= 10) return raw;
  if (parts.length === 1) return raw.slice(0, 8);
  const initials = parts.map((p) => p[0]).join("").toUpperCase();
  if (initials.length >= 2 && initials.length <= 4) return initials;
  return parts[0].slice(0, 8);
}

function toInt(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 0-based pick index for a stable column in a 0-based round. */
export function pickIndexForCell(roundIndex0, columnIndex, teamCount, draftType) {
  const n = Math.max(1, Number(teamCount) || 1);
  const col = Math.max(0, Math.min(n - 1, Number(columnIndex) || 0));
  const rnd = Math.max(0, Number(roundIndex0) || 0);
  const snake = normalizeDraftType(draftType) === "snake";
  if (snake && rnd % 2 === 1) {
    return rnd * n + (n - 1 - col);
  }
  return rnd * n + col;
}

export function overallPickForCell(roundIndex0, columnIndex, teamCount, draftType) {
  return pickIndexForCell(roundIndex0, columnIndex, teamCount, draftType) + 1;
}

/** 1-based pick within the round's sequence (1.01, 2.12, …). */
export function slotInRound(roundIndex0, columnIndex, teamCount, draftType) {
  const n = Math.max(1, Number(teamCount) || 1);
  const col = Math.max(0, Math.min(n - 1, Number(columnIndex) || 0));
  const rnd = Math.max(0, Number(roundIndex0) || 0);
  if (normalizeDraftType(draftType) === "snake" && rnd % 2 === 1) {
    return n - col;
  }
  return col + 1;
}

export function formatPickLabel(round1, slot1) {
  const r = Number(round1);
  const s = Number(slot1);
  if (!Number.isFinite(r) || !Number.isFinite(s)) return "";
  return `${r}.${String(s).padStart(2, "0")}`;
}

export function columnTeamId(order, columnIndex) {
  const list = Array.isArray(order) ? order : [];
  if (!list.length) return null;
  const idx = Math.max(0, Math.min(list.length - 1, Number(columnIndex) || 0));
  return list[idx] != null ? String(list[idx]) : null;
}

export function isSnakeTurnRound(round1) {
  return Number(round1) > 1 && Number(round1) % 2 === 0;
}

function pickFromEvent(ev) {
  const p = ev?.payload || ev || {};
  const overall = toInt(p.overall);
  return {
    event_type: ev?.event_type || "pick",
    overall,
    round: toInt(p.round),
    slot: toInt(p.slot),
    team_id: p.team_id != null ? String(p.team_id) : (p.picking_team_id != null ? String(p.picking_team_id) : ""),
    team_name: p.team_name || p.picking_team_name || "",
    player_id: p.player_id != null ? String(p.player_id) : "",
    player_name: p.player_name || p.player || "",
    position: p.position || "",
    nfl_team: p.team || p.nfl_team || "",
    season_proj: p.season_proj ?? p.season_p50 ?? null,
  };
}

/** Map overall pick number -> pick payload. Uses events, never roster order. */
export function picksByOverall(events) {
  const map = new Map();
  for (const ev of events || []) {
    const kind = ev?.event_type || ev?.type;
    if (kind && kind !== "pick") continue;
    const row = pickFromEvent(ev);
    if (!row.overall) continue;
    map.set(row.overall, row);
  }
  return map;
}

export function configuredRounds(rules, { pickCount, currentOverall, eventMaxRound } = {}) {
  const explicit = toInt(rules?.roster_size_max);
  let fromRoster = 0;
  const roster = rules?.roster || {};
  for (const [key, val] of Object.entries(roster)) {
    if (key === "flex" || !val || typeof val !== "object") continue;
    fromRoster += Number(val.max || 0);
  }
  const configured = explicit || fromRoster || 16;
  const inferred = Math.max(
    toInt(eventMaxRound) || 0,
    currentOverall ? Math.ceil(Number(currentOverall) / Math.max(1, Number(pickCount) || 1)) : 0,
  );
  return Math.max(1, configured, inferred);
}

export function visibleRoundWindow(rows, focusRound, windowSize = 3) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const count = Math.max(1, Math.min(list.length, Number(windowSize) || 3));
  const focusIndex = Math.max(0, Math.min(list.length - 1, (Number(focusRound) || 1) - 1));
  let start = Math.max(0, focusIndex - Math.floor(count / 2));
  start = Math.min(start, Math.max(0, list.length - count));
  return list.slice(start, start + count);
}

export function viewerNextPick({
  order,
  viewerTeamId,
  currentOverall,
  draftType,
  totalRounds,
} = {}) {
  const list = Array.isArray(order) ? order.map(String) : [];
  const n = list.length;
  const viewer = viewerTeamId != null ? String(viewerTeamId) : "";
  if (!n || !viewer) return null;
  const current = Math.max(1, Number(currentOverall) || 1);
  const rounds = Math.max(1, Number(totalRounds) || 16);
  const last = rounds * n;
  for (let overall = current; overall <= last; overall += 1) {
    const idx = overall - 1;
    const rnd = Math.floor(idx / n);
    let slot = idx % n;
    if (normalizeDraftType(draftType) === "snake" && rnd % 2 === 1) slot = n - 1 - slot;
    if (String(list[slot]) === viewer) {
      const slot1 = slotInRound(rnd, list.indexOf(viewer), n, draftType);
      return {
        overall,
        round: rnd + 1,
        slot: slot1,
        label: formatPickLabel(rnd + 1, slot1),
        picksAway: overall - current,
        isCurrent: overall === current,
      };
    }
  }
  return null;
}

/**
 * Convert room state into a conventional draft grid:
 * rows = rounds, columns = original nomination-order seats (never reversed).
 */
export function buildDraftBoard({
  nominationOrder,
  teams,
  events,
  draftType,
  currentOverall,
  viewerTeamId,
  rules,
  totalRounds: totalRoundsProp,
} = {}) {
  const type = normalizeDraftType(draftType);
  const order = (nominationOrder || []).map((id) => String(id)).filter(Boolean);
  const teamMap = new Map((teams || []).map((t) => [String(t.id), t]));
  const n = order.length;
  const pickMap = picksByOverall(events);
  const eventMaxRound = Math.max(0, ...[...pickMap.values()].map((p) => Number(p.round) || 0));
  const rounds = Math.max(
    1,
    Number(totalRoundsProp) || configuredRounds(rules, {
      pickCount: n,
      currentOverall,
      eventMaxRound,
    }),
  );
  const rawCurrent = Math.max(0, Number(currentOverall) || 0);
  const maxOverall = rounds * Math.max(1, n);
  const current = rawCurrent > 0 && rawCurrent <= maxOverall ? rawCurrent : 0;
  const currentRound = rawCurrent > maxOverall
    ? rounds
    : current && n
      ? Math.ceil(current / n)
      : 1;
  const viewer = viewerTeamId != null ? String(viewerTeamId) : "";

  const columns = order.map((teamId, columnIndex) => {
    const team = teamMap.get(teamId) || {};
    const name = team.name || `Team ${columnIndex + 1}`;
    return {
      columnIndex,
      teamId,
      teamName: name,
      abbrev: abbreviateTeamName(name, `T${columnIndex + 1}`),
      isViewer: Boolean(viewer) && teamId === viewer,
    };
  });

  const rows = [];
  for (let r = 0; r < rounds; r += 1) {
    const round1 = r + 1;
    const cells = columns.map((col) => {
      const overall = n ? overallPickForCell(r, col.columnIndex, n, type) : r + 1;
      const slot = n ? slotInRound(r, col.columnIndex, n, type) : 1;
      const pick = pickMap.get(overall) || null;
      const isActive = current > 0 && overall === current && !pick;
      const isViewerCell = Boolean(viewer) && col.teamId === viewer;
      return {
        round: round1,
        columnIndex: col.columnIndex,
        overall,
        slot,
        label: formatPickLabel(round1, slot),
        teamId: col.teamId,
        teamName: col.teamName,
        teamAbbrev: col.abbrev,
        pick,
        filled: Boolean(pick?.player_name),
        isActive,
        isViewer: isViewerCell,
        isSnakeTurn: type === "snake" && isSnakeTurnRound(round1) && slot === 1,
      };
    });
    rows.push({
      round: round1,
      reverses: type === "snake" && round1 % 2 === 0,
      cells,
    });
  }

  const next = viewerNextPick({
    order,
    viewerTeamId: viewer,
    currentOverall: rawCurrent > maxOverall ? maxOverall + 1 : (current || 1),
    draftType: type,
    totalRounds: rounds,
  });

  return {
    draftType: type,
    teamCount: n,
    totalRounds: rounds,
    currentOverall: current,
    currentRound,
    columns,
    rows,
    viewerTeamId: viewer,
    nextPick: next,
    snake: type === "snake",
  };
}
