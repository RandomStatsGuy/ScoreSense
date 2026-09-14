import { leagueUsesSalaries } from "./leagueCapabilities.js";

/** group: "home" | "prep" (draft prep) | "season" (in-season) | "office" (league-wide). */
export const HUB_SUBVIEWS = [
  { id: "home", label: "Home", shortLabel: "Home", hint: "What to do next", group: "home" },
  { id: "value", label: "Strategy", shortLabel: "Strategy", hint: "Who you take first", group: "prep" },
  { id: "room", label: "Draft", shortLabel: "Draft", hint: "Draft night and the room", group: "prep" },
  { id: "week", label: "This Week", shortLabel: "Week", hint: "Start or sit", group: "season" },
  { id: "vibes", label: "Vibes", shortLabel: "Vibes", hint: "One read per player today", group: "season" },
  { id: "game", label: "Game center", shortLabel: "Game", leagueOnly: true, hint: "Your matchup, live", group: "season" },
  { id: "roster", label: "My team", shortLabel: "My team", hint: "Your contracts", noMoneyHint: "Your roster", group: "season" },
  { id: "available", label: "Free agents", shortLabel: "FA", hint: "Who you can still add", group: "season" },
  { id: "rosters", label: "Rosters", shortLabel: "Rosters", leagueOnly: true, hint: "Overpays and cheap years across the league", noMoneyHint: "Roster strength across the league", group: "season" },
  { id: "planner", label: "Cap", shortLabel: "Cap", hint: "Bids, cuts, leftover cap", group: "season", salaryOnly: true },
  { id: "trades", label: "Trades", shortLabel: "Trades", leagueOnly: true, hint: "Cap-checked deals", noMoneyHint: "Roster-checked deals", group: "season" },
  { id: "rules", label: "Rules", shortLabel: "Rules", hint: "What new contracts cost", noMoneyHint: "League settings", group: "office" },
  {
    id: "office",
    label: "Roster management",
    shortLabel: "Manage",
    leagueOnly: true,
    commissionerOnly: true,
    hint: "Contracts, members, access",
    noMoneyHint: "Members and access",
    group: "office",
  },
  { id: "insights", label: "Insights", shortLabel: "Insights", leagueOnly: true, hint: "Winners and spend", noMoneyHint: "Winners and records", group: "office" },
];

export const HUB_GROUP_LABELS = { home: "Home", prep: "Draft", season: "Team", office: "League" };

export function filterHubSubviews(hubContext) {
  const inLeague = hubContext?.mode === "league" || Boolean(hubContext?.league_id);
  const usesSalaries = leagueUsesSalaries(hubContext);
  return HUB_SUBVIEWS.filter((v) => {
    if (v.commissionerOnly && !hubContext?.is_commissioner) return false;
    if (v.leagueOnly && !inLeague) return false;
    if (v.salaryOnly && !usesSalaries) return false;
    return true;
  }).map((v) => (usesSalaries || !v.noMoneyHint ? v : { ...v, hint: v.noMoneyHint }));
}

export function hubDestinationGroups(hubContext) {
  const visible = filterHubSubviews(hubContext);
  const out = [];
  visible.forEach((item) => {
    let group = out.find((entry) => entry.id === item.group);
    if (!group) {
      group = { id: item.group, label: HUB_GROUP_LABELS[item.group], items: [] };
      out.push(group);
    }
    group.items.push(item);
  });
  return out;
}
