/** Exact decimal conversion. Bounds are counts over the requested portfolio. */
function decimal(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error("Use a number from 0 to 100 with up to six decimal places.");
  const [whole, fraction = ""] = text.split(".");
  return { numerator: BigInt(whole + fraction), denominator: 10n ** BigInt(fraction.length) };
}

export function exposureCount(value, count, kind, unit = "percent") {
  if (value == null || String(value).trim() === "") return null;
  if (!Number.isSafeInteger(count) || count < 1 || count > 150) throw new Error("Choose a lineup count from 1 to 150 first.");
  if (unit === "count") {
    if (!(kind === "target" ? /^\d+(?:\.\d{1,6})?$/ : /^\d+$/).test(String(value)) || Number(value) > count) throw new Error(`Appearances must be from 0 to ${count}; hard bounds use whole counts.`);
    return Number(value);
  }
  const { numerator, denominator } = decimal(value);
  if (numerator > 100n * denominator) throw new Error("Exposure must be from 0 to 100%.");
  const scaled = numerator * BigInt(count), divisor = denominator * 100n;
  if (kind === "min") return Number((scaled + divisor - 1n) / divisor);
  if (kind === "max") return Number(scaled / divisor);
  return Number(scaled) / Number(divisor);
}

export function exposureRequest(rules, count, locked = [], excluded = [], defaultMax = 1) {
  const result = {};
  for (const [id, rule] of Object.entries(rules)) {
    const bounds = {};
    for (const kind of ["min", "target", "max"]) {
      const number = exposureCount(rule[kind], count, kind, rule.unit);
      if (number !== null) {
        // Fractions retain decimal text for the backend's Decimal rounding.
        const [whole, fraction = ""] = String(rule[kind]).split(".");
        const digits = (whole + fraction).padStart(fraction.length + 3, "0");
        bounds[kind] = rule.unit === "count" ? { count: number } : `${digits.slice(0, -fraction.length - 2)}.${digits.slice(-fraction.length - 2)}`.replace(/0+$/, "").replace(/\.$/, "");
      }
    }
    if (Object.keys(bounds).length) result[id] = bounds;
    const lower = exposureCount(rule.min, count, "min", rule.unit) ?? 0;
    const sharedUpper = Math.floor(defaultMax * count + 1e-9);
    const upper = Math.min(exposureCount(rule.max, count, "max", rule.unit) ?? sharedUpper, sharedUpper);
    if (lower > upper) throw new Error(`${id}: minimum ${lower} exceeds maximum ${upper}.`);
    if (locked.includes(id) && upper < count) throw new Error(`${id}: locked in all ${count} lineups but maximum is ${upper}.`);
    if (excluded.includes(id) && lower > 0) throw new Error(`${id}: skipped but minimum is ${lower}.`);
  }
  for (const id of locked) {
    if (!result[id] && defaultMax < 1) throw new Error(`${id}: a global lock conflicts with the shared maximum. Set the maximum to 100% or unlock this player.`);
  }
  return result;
}

export function convertExposureUnits(rules, count, unit) {
  return Object.fromEntries(Object.entries(rules).map(([id, rule]) => {
    const next = { unit };
    for (const kind of ["min", "target", "max"]) {
      const n = exposureCount(rule[kind], count, kind, rule.unit);
      if (n === null) continue;
      if (unit === "count") next[kind] = String(n);
      else {
        const raw = n * 100 / count;
        // Preserve the exact hard appearance count when showing a percentage.
        const shown = kind === "min" ? Math.floor(raw * 1e6) / 1e6 : kind === "max" ? Math.ceil(raw * 1e6) / 1e6 : raw;
        next[kind] = shown.toFixed(6).replace(/\.?0+$/, "");
      }
    }
    return [id, next];
  }));
}

/** Slot permutations never create a second scoring outcome. */
export function auditGlobalStructure(lineups) {
  const pairs = new Map(), flex = { RB: 0, WR: 0, TE: 0 };
  for (const entry of lineups) {
    const players = [...new Map(entry.lineup.map(p => [String(p.player_id), p])).values()];
    const position = entry.lineup.find(p => p.slot === "FLEX")?.position;
    if (Object.hasOwn(flex, position)) flex[position]++;
    for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
      const pair = [players[i], players[j]].sort((a, b) => String(a.player_id).localeCompare(String(b.player_id)));
      const key = JSON.stringify(pair.map(p => String(p.player_id)));
      const row = pairs.get(key) || { key, ids: pair.map(p => p.player_id), names: pair.map(p => p.player), count: 0, rb: pair.every(p => p.position === "RB") };
      row.count++; pairs.set(key, row);
    }
  }
  return { total: lineups.length, flex, pairs: [...pairs.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)) };
}
