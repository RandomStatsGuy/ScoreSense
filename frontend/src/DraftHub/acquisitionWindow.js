/** Players-tab add vs bid vs lock copy. */

export const PLAYERS_TAB_COPY = {
  add: "Add",
  bid: "Bid",
  reassign: "Reassign",
  lockedReason: "Adds open after the draft",
  star: "Star for draft",
  starred: "Starred for draft",
  unstar: "Remove star",
  howAddsWork: "How adds work",
  howAddsBody:
    "Adds follow the league calendar. Before the draft, pickups go through the live room. After it, Bid or Add on the row when the window is open.",
  starHint: "Star a name to queue it for draft night.",
  history: "History",
  seasonPts: "Season pts",
};

export function playersTabAddMode(window, { inLeague = false, draftConsole = false } = {}) {
  if (draftConsole) return "hidden";
  if (!inLeague) return "add";
  const mode = String(window?.add_mode || "locked");
  if (mode === "add" || mode === "bid" || mode === "locked") return mode;
  return "locked";
}

export function playersTabAddLabel(mode, { taken = false, isCommissioner = false } = {}) {
  if (mode === "bid") return PLAYERS_TAB_COPY.bid;
  if (taken && isCommissioner) return PLAYERS_TAB_COPY.reassign;
  return PLAYERS_TAB_COPY.add;
}

export function playersTabAddDisabledReason(mode) {
  if (mode === "locked") return PLAYERS_TAB_COPY.lockedReason;
  return "";
}

export function playersTabStarCopy(starred = false) {
  return starred ? PLAYERS_TAB_COPY.starred : PLAYERS_TAB_COPY.star;
}

export function playerTradeableInWindow(row, window) {
  if (!window || window.trade_scope !== "surviving_contracts") return true;
  if (String(row?.acquisition_type || row?.contract?.acquisition_type || "").toLowerCase() === "fa_contract") {
    return false;
  }
  const pending = row?.contract?.pending_extension || row?.pending_extension;
  if (pending && typeof pending === "object") return true;
  const yrs = Number(row?.years_remaining ?? row?.contract?.years_remaining ?? row?.contract_years ?? 1);
  return Number.isFinite(yrs) && yrs > 1;
}

export function playersTabLockedChip() {
  return {
    label: "Locked",
    popover: PLAYERS_TAB_COPY.lockedReason,
  };
}

export function playersTabBanner(window) {
  if (!window) return null;
  return {
    variant: window.add_mode === "locked" ? "warn" : window.add_mode === "bid" ? "warn" : "info",
    text: window.message || window.label,
    label: window.label,
  };
}

export function tradesWindowBanner(window) {
  if (!window || window.trade_scope !== "surviving_contracts") return null;
  return {
    variant: "info",
    text: window.message
      || "Offseason trades are limited to contracts that continue beyond the upcoming draft.",
    label: window.label || "Offseason",
  };
}
