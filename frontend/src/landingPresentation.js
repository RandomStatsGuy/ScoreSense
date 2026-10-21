import { normalizePublicEntryPath } from "./publicEntry.js";

/** Public landing content. Demo values are illustrative, never live player forecasts. */
export const LANDING_INTENTS = Object.freeze([
  { id: "weekly", area: "Projections", title: "Compare player projections", mobile: "Projections", hint: "Free · No account needed", landing: "/projections", path: "/projections/weekly", closing: "Weekly and season projections. Free, with no account needed." },
  { id: "fantasy", area: "Fantasy", title: "Create or join a league", mobile: "Fantasy", hint: "Leagues · Account required", landing: "/fantasy", path: "/hub/home", closing: "Create or join a pick or salary-cap league with a ScoreSense account." },
  { id: "tools", area: "Tools", title: "Practice a draft or try DFS", mobile: "Tools", hint: "Drafts and DFS · Account required", landing: "/tools", path: "/tools/mock-draft", closing: "Mock drafts, DFS lineups and best ball. Sign in to use the tools." },
]);

export function landingIntent(value) {
  return LANDING_INTENTS.find(item => item.id === value) || LANDING_INTENTS[0];
}

export function landingAuthHref(intent, mode = "register") {
  const selected = landingIntent(intent);
  const search = new URLSearchParams({ next: selected.path, from: "landing", intent: selected.id });
  return `${mode === "login" ? "/login" : "/register"}?${search}`;
}

export function landingForPath(pathname = "") {
  return LANDING_INTENTS.find(item => item.landing === normalizePublicEntryPath(pathname)) || null;
}

/** A sample leads to its product page; the product page names its actual access requirement. */
export function landingAction(intent, { authenticated = false, overview = false } = {}) {
  const selected = landingIntent(intent);
  if (overview) return { href: selected.landing, label: `Explore ${selected.area}`, note: selected.id === "weekly" ? "Free projections. No account needed." : `Try the ${selected.area} preview, then create an account to use the full product.` };
  if (selected.id === "weekly") return { href: selected.path, label: "Explore projections", note: "Free. No account needed." };
  return { href: authenticated ? selected.path : landingAuthHref(selected.id), label: authenticated ? `Open ${selected.area}` : "Create account", note: authenticated ? "Continue to the full product." : `An account is required to use ${selected.area}.` };
}

export const LANDING_PLAYERS = Object.freeze([
  { id: "brown", name: "Amon-Ra St. Brown", number: "14", typical: "18.4", floor: "9.8", ceiling: "28.6", marker: "47%" },
  { id: "london", name: "Drake London", number: "5", typical: "16.9", floor: "7.2", ceiling: "29.1", marker: "44%" },
]);

export const LANDING_COPY = Object.freeze({
  pageTitle: "Fantasy leagues, projections and draft tools",
  skip: "Skip to content", home: "ScoreSense home", by: "By", nav: "Product areas", signIn: "Sign in", create: "Create account",
  eyebrow: "Fantasy football", heading: ["Fantasy football.", "The numbers made simple."],
  intro: "Compare players, practice a draft, or make a league your own. ScoreSense brings the numbers into clear visuals and tools you can play with. Start with free player projections, no account needed.",
  start: "What would you like to try?", inside: "What you can do", openProduct: "Open the app",
  sample: "Interactive sample", sampleRegion: "Interactive product sample", theme: "Color theme",
  heroTail: ["A feel for football. A clear look at the numbers.", "Choose a product and try its preview."], explore: "See the features", exploreLabel: "See what you can do in ScoreSense",
  weekly: {
    eyebrow: "Player projections", title: "Compare the floor and ceiling.", selected: "Selected player · WR", outlook: "Sample weekly PPR projection",
    typical: "Median · P50", floor: "Floor", ceiling: "Ceiling", p10: "P10", p90: "P90", range: "Projected range · P10–P90",
    lower: "Lower outcome", higher: "Higher outcome", choices: "Compare sample players", rowHint: "WR · Sample projection", points: "pts",
    note: "Choose a player to explore. Sample players and values, not current projections.",
  },
  fantasy: {
    eyebrow: "Your league", title: ["Matchups, standings,", "and league chat."],
    first: "Northside", firstOwner: "Maya · 4–2", second: "Sunday Scaries", secondOwner: "Jordan · 3–3", sample: "Sample matchup", firstScore: "108.6", secondScore: "104.2", vs: "vs", points: "Projected PPR points",
    author: "Jordan", chatLabel: "League chat · Sample", chat: "Anyone watching the late game?",
    room: "Choose your team-room background.", roomHint: "Try the stadium or city.", group: "Team room backdrop", stadium: "Stadium", city: "City",
    note: "Illustrative league, conversation and projections. No live league data.", backdropSelected: "team-room backdrop selected.",
  },
  tools: {
    eyebrow: "Mock drafts", title: ["Try a mock draft", "before draft night."],
    sample: "Mock draft · Example picks", round: "Round 2", pick: "Pick 07", receiver: "Receiver first", runningBack: "Running back", yourPick: "2.07 · Your pick", choices: "Try an approach", group: "Mock draft strategy",
    balanced: "Balanced", receivers: "WR heavy", balancedPick: "Pick a running back", receiversPick: "Pick another receiver",
    balancedNote: "With a receiver already picked, take a running back next.",
    receiversNote: "Pick a second receiver. You’ll still need running backs in later rounds.",
    index: ["Mock draft", "DFS lineups", "Best ball board"], note: "Sample picks only. Full mock drafts run against bots or other managers.",
  },
  ways: {
    eyebrow: "What you can do", title: ["Start a league,", "or use the tools on your own."],
    intro: "Explore projections freely. Create an account for Fantasy or Tools when you’re ready for a league, a practice draft or your next DFS lineup.",
    rows: [
      { intent: "weekly", area: "Projections", title: ["Compare players", "with the range in view."], text: "Weekly and season PPR projections include a floor, median and ceiling. Explore the boards and player details for free, without an account.", link: "Explore Projections" },
      { intent: "fantasy", area: "Fantasy", title: ["Make a league.", "Make it yours."], text: "Create a pick or salary-cap league. Draft, set lineups, make trades and follow your matchups, with a team room you can customize. An account is required.", link: "Explore Fantasy" },
      { intent: "tools", area: "Tools", title: ["Practice a draft.", "Build DFS lineups."], text: "Run mock drafts, build DFS lineups with locks, stacks and exposure limits, or compare best-ball rankings with FantasyPros consensus. An account is required.", link: "Explore Tools" },
    ], rivalry: "League matchups",
  },
  league: {
    sampleName: "Sunday Social", sample: "Sample team room", jerseyLabels: ["Your roster", "Your colors", "Your team"], caption: "Your team room",
    eyebrow: "League options", title: ["Contracts and cap,", "when you want them."],
    intro: "Salary-cap leagues can manage player contracts, eligible extensions and dead cap. Pick leagues use roster limits without contract or cap screens.",
    features: [
      ["Check the cap before a move.", "Preview how a cut, extension or bid changes your available cap."],
      ["Chat and follow matchups.", "League conversation and standings sit alongside the weekly matchup."],
      ["Customize your team room.", "Choose a team name, photo, banner and room background."],
    ],
  },
  models: {
    eyebrow: "Where your league plays", title: ["Play in ScoreSense", "or link Sleeper."], intro: "You can host your league here or use ScoreSense alongside Sleeper. Here’s what each option does.",
    native: "A ScoreSense league", nativeText: "Create a pick or salary-cap league, draft here and set your weekly lineup here. Scoring is configurable and defaults to full PPR.",
    linked: "A linked Sleeper league", linkedText: "Use ScoreSense for projections and planning, with contract tools for salary-cap leagues. Sleeper still handles scoring, lineup changes and player moves.",
    note: "Just here for Projections or Tools? You can start without creating a league.",
  },
  faq: {
    eyebrow: "Good to know", title: "A few practical details", rows: [
      ["What can I use without an account?", "The full weekly and season projection boards, player details and comparisons are free to explore without an account. Fantasy and Tools require an account; their samples on these pages are open to everyone."],
      ["Do I need to bring my whole league?", "No. Projections are free without an account. You can use Tools on your own with an account. Make or link a league when you want to play with a group."],
      ["Does ScoreSense replace Sleeper?", "Only if you choose to run your league here. Linked leagues still use Sleeper for lineups, scoring and player moves; ScoreSense provides extra projections and planning tools."],
      ["Do leagues have to use contracts?", "No. Pick leagues use roster limits without salaries or contracts. Salary-cap leagues add contract, extension and cap tools."],
      ["What do floor and ceiling mean?", "The floor (P10), median (P50) and ceiling (P90) show different points in a projected range. They describe uncertainty, not a guaranteed result. The figures on this page are sample values."],
      ["Are these previews live data?", "No. The previews use illustrative player values, league details and draft choices. Explore the full projections to see the available forecasts. Create an account to use Fantasy or Tools."],
    ],
  },
  closing: { eyebrow: "Get started", title: ["Pick your", "starting point."], note: "Explore the product you picked." },
  terms: "Terms", privacy: "Privacy", legalNav: "Legal", disclaimer: "Projections and DFS tools are for entertainment and research.",
});

export const LANDING_PRODUCTS = Object.freeze({
  weekly: {
    pageTitle: "Free fantasy football projections", eyebrow: "Projections", heading: ["Player projections.", "Made easy to explore."],
    intro: "A player is more than one projected score. Compare their floor, median and ceiling, open the player details, and follow the weekly or season outlook. The full projections are free, with no account needed.",
    points: [["Weekly and season", "Choose a starter now or look at the season ahead."], ["See the range", "Read the floor, median and ceiling together."], ["Compare players", "Put players side by side when a choice is close."]],
    heroTail: ["The full projection boards are open to everyone.", "Free. No account needed."],
    ways: { eyebrow: "Inside Projections", title: ["Find your player.", "Get a clearer read."], intro: "Start with the board, then open the details that matter to your choice.", rows: [
      { intent: "weekly", area: "Player outlooks", title: ["A forecast", "with context."], text: "Browse weekly and season PPR estimates, compare players, and open a player’s details. Floor, median and ceiling describe different possible outcomes; they are estimates, not promises.", link: "Open the full projections", path: "/projections/weekly" },
    ] },
    faq: { eyebrow: "Good to know", title: "Before you explore", rows: [
      ["Do I need an account?", "No. Weekly and season projections, player details and player comparisons are publicly available for free."],
      ["What do floor and ceiling mean?", "The floor (P10), median (P50) and ceiling (P90) describe points in a projected range. They help show uncertainty; actual results can fall outside that range."],
      ["Are the preview values current?", "The preview is an interactive example. Open the full projections for the available forecasts and their season or week."],
    ] },
    closing: { eyebrow: "Ready to explore", title: ["Your players.", "Their projections."], note: "Open the full board. No signup step." },
  },
  fantasy: {
    pageTitle: "Fantasy football leagues", eyebrow: "Fantasy", heading: ["Your league.", "A little more personal."],
    intro: "Draft, set lineups, make trades and follow the matchups in one place. Give your team its own room, keep the league conversation close, and choose pick or salary-cap rules. Create an account to get started.",
    points: [["Play the season", "Draft, lineups, trades and weekly matchups."], ["Make it yours", "Your team name, photo, banner and room."], ["Choose your format", "Pick leagues or optional contracts and salary cap."]],
    heroTail: ["Try the team room below.", "An account opens the full Fantasy experience."],
    ways: { eyebrow: "Inside Fantasy", title: ["The league details.", "The game-day company."], intro: "The practical parts of running a team sit alongside the people you play with.", rows: [
      { intent: "fantasy", area: "Your season", title: ["Draft together.", "Follow every matchup."], text: "Create a pick or salary-cap league, invite managers, draft and manage your team. Your room, league conversation and standings keep the season connected.", link: "Try the league preview", preview: true },
    ] },
    faq: { eyebrow: "Good to know", title: "Before you join", rows: [
      ["Do I need an account?", "Yes. You can explore the sample here without one. Create an account or sign in to create or join a league."],
      ["Do I have to use contracts?", "No. Pick leagues use roster limits. Salary-cap leagues add contracts, eligible extensions and dead-cap tools."],
      ["Can I keep using Sleeper?", "Yes. Linked leagues keep Sleeper for lineups, scoring and player moves. ScoreSense provides projections and planning, including contract tools for salary-cap leagues."],
    ] },
    closing: { eyebrow: "Get started", title: ["Make a place", "for your league."], note: "Create an account or sign in to continue." },
  },
  tools: {
    pageTitle: "Fantasy football draft and DFS tools", eyebrow: "Tools", heading: ["Try the draft.", "Build the lineup."],
    intro: "Practice a draft before draft night. Build DFS lineups with the players and stacks you choose, or compare the best-ball board with consensus rankings. Try the sample, then create an account to use the tools.",
    points: [["Mock drafts", "Practice against bots or other managers."], ["DFS lineups", "Use player locks, stacks and exposure limits."], ["Best ball", "Compare rankings with FantasyPros consensus."]],
    heroTail: ["Practice and experiment at your own pace.", "An account opens the full Tools experience."],
    ways: { eyebrow: "Inside Tools", title: ["Choose an approach.", "See what you can build."], intro: "Useful controls, immediate feedback, and room to change your mind.", rows: [
      { intent: "tools", area: "Drafts and lineups", title: ["Rehearse your picks.", "Set your DFS choices."], text: "Mock drafts give you a practice room. DFS tools support locks, stacks, exposure limits and CSV exports. The best-ball board compares player rankings with FantasyPros consensus.", link: "Try the draft preview", preview: true },
    ] },
    faq: { eyebrow: "Good to know", title: "Before you start", rows: [
      ["Do I need an account?", "Yes. The sample here is open to everyone. Sign in or create an account for full mock drafts, DFS tools and the best-ball board."],
      ["Do I need a league?", "No. You can use the Tools area on your own with a ScoreSense account."],
      ["Does the sample run a full mock draft?", "No. It shows how a choice changes the example pick. Full mock drafts run against bots or other managers in the app."],
    ] },
    closing: { eyebrow: "Get started", title: ["Give your draft", "a practice run."], note: "Create an account or sign in to continue." },
  },
});

export function landingContent(intent) {
  return intent ? { ...LANDING_COPY, ...LANDING_PRODUCTS[landingIntent(intent).id] } : LANDING_COPY;
}

export function landingSelectionAnnouncement(intent) {
  const selected = landingIntent(intent);
  return `${selected.area} preview selected. Explore ${selected.area} to see its product page.`;
}

export function landingPlayerRangeLabel(player) {
  return `Sample PPR projection for ${player.name}: floor ${player.floor}, median ${player.typical}, ceiling ${player.ceiling}`;
}
