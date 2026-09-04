/** Session seed so Rosters → Trades can prefill the builder. */

const KEY = "ss_hub_trade_seed";

export function seedTradePartner(teamId) {
  try {
    const existing = readTradeSeed() || { players: [] };
    sessionStorage.setItem(KEY, JSON.stringify({
      ...existing,
      partnerTeamId: teamId,
      at: Date.now(),
    }));
  } catch {
    /* ignore */
  }
}

export function seedTradeFromPlayer(player) {
  try {
    const existing = readTradeSeed() || { players: [] };
    const players = [...(existing.players || [])];
    if (!players.some((p) => p.player_id === player.player_id)) {
      players.push(player);
    }
    sessionStorage.setItem(KEY, JSON.stringify({ players, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function readTradeSeed() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearTradeSeed() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
