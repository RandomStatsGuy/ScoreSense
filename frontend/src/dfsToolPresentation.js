/** Shared DFS / lineup-builder presentation (Tools → DFS). */

import { displayNflTeam } from "./nflTeamAbbrev.js";

export const DFS_SHOWDOWN_COPY = {
  pairing: "WR/TE Captain with own quarterback", policies: [{ id: "require", label: "Require" }, { id: "warn", label: "Warn" }, { id: "off", label: "Off" }],
  strategyDefault: "Strategy default · not a contest rule", pairingHelp: "Require pairs a receiver Captain with an approved same-team quarterback. Verify your choice; backups are never selected automatically.",
  qbChoice: team => `${team} pairing quarterback`, noQb: "Use verified starter, if available", verified: "Verified starter", approved: "Your approved choice", missingQb: "No verified quarterback is mapped. Choose one under Advanced rules before requiring this pairing.", pairingMissing: teams => `WR/TE Captains from ${teams.join(" / ")} need an approved QB. Choose under Advanced rules.`,
  exception: policy => `Captain pairing: ${policy === "warn" ? "warn only" : "off"}`, legacyPolicy: "Historical rules · pairing was not required", explicitApproval: "Selecting a quarterback approves that identity for pairing; it does not lock him into every lineup.",
  objectives: { median: "Projection sum", floor: "P10-input score", ceiling: "P90-input score", value: "Value-input score" },
  pointUnits: "points", valueUnits: "points per $1,000", projection: "Projection sum", projectionUnknown: "Sum of player estimates · statistic unknown",
  scoreHelp: { median: "Adds the player projection inputs with the Captain multiplier once. See source details for each input’s statistic.", floor: "Adds each player's P10 input, including the Captain multiplier. Not a predicted lineup percentile.", ceiling: "Adds each player's P90 input, including the Captain multiplier. Not a predicted lineup percentile.", value: "Adds each slot's projected points per $1,000 of salary. This score is not fantasy points." },
  scoreMismatch: "The returned score differs from the roster inputs. Review the diagnostic before using this result.", scoring: "Scoring & input details", forecast: "Forecast snapshot", injurySnapshot: "Injury snapshot", conditioning: "Availability basis", unknown: "Unavailable",
  status: { questionable: "Questionable", doubtful: "Doubtful", out: "Out", ir: "IR", limited: "Limited", active: "Active", unknown: "Unknown", inactive: "Inactive", pup: "PUP", suspended: "Suspended" },
  atBuild: "At build", latest: "Latest", latestPending: "Latest available update · not applied", statusTime: "Status as of", source: "Source", role: "Role evidence", noRole: "Current role estimate unavailable.",
  sourceDetails: "Source & role", raw: "Frozen input diagnostic", missingZero: "Zero-score probability unavailable.", inputValue: "Slot objective input", inclusion: "Construction inputs", inclusionHelp: "Salary, selected score and enforced rules describe this inclusion. They do not establish a projected workload or explain portfolio-wide omission.",
  lowSalary: "Low salary · 10% of cap or less", inputGaps: "Missing inputs", gapLabels: { statusUnknown: "availability", roleUnknown: "role estimate", zeroUnknown: "zero-score chance" },
  gapSummary: labels => `${labels.join(" · ")} unavailable.`, lowSalaryHelp: "Low salary helps fit other players. It does not establish workload.", zeroChance: "Zero-score chance",
  review: "Construction review", reviewCount: count => `${count} lineup${count === 1 ? " needs" : "s need"} review`, filter: "Show lineups needing review", all: "Show all lineups", warningCount: count => `${count} lineup${count === 1 ? "" : "s"}`, exceptionLabel: "Policy exception", noWarnings: "No returned construction findings.",
  warnings: { receiver_captain_without_qb: "Receiver Captain without paired QB", receiver_captain_qb_unknown: "Captain pairing needs a QB identity", qb_opposing_dst: "Quarterback against opposing defense", captain_opposing_dst: "Captain against opposing defense", shared_backfield: "Shared backfield exposure", selected_availability: "Availability needs review", role_unavailable: "Role estimate unavailable", projection_fallback: "Fallback projection source", stale_forecast: "Forecast timestamp needs review", stale_role_evidence: "Role evidence needs review", shared_personnel_assumption: "Shared personnel assumption", high_captain_concentration: "Captain concentration" },
  total: "Total", captain: "Captain", flex: "FLEX only", appearances: (count, share) => `${count} · ${(share * 100).toFixed(0)}%`,
  compareTitle: "Compare with a player", comparePlayer: "Player to compare", choosePlayer: "Choose a player", placement: "Include as", placements: [{ id: "flex", label: "Include in FLEX" }, { id: "captain", label: "Use as Captain" }],
  compare: "Compare complete lineups", comparing: "Comparing…", cancel: "Cancel comparison", cancelled: "Comparison cancelled. Previous result retained.",
  compareHelp: "One lineup on your frozen inputs. Locks, skips, salary and Captain pairing apply; zero Captain limits stay excluded. Positive exposure limits and lineup count do not apply.",
  exposureScope: "Positive exposure limits are recorded for context. Zero Captain limits remain excluded from that role.",
  cancelHelp: "Cancel stops waiting; the server may finish its bounded solve.",
  compareNeedsBuild: "Build a Showdown set first to compare on its original inputs.", baseline: "Baseline", forced: "With selected player", tradeoffs: "What changed", added: "Added", removed: "Removed", salary: "Salary used", unused: "Salary left", objectiveDelta: "Score change", newWarnings: "New findings", removedWarnings: "Resolved findings",
  solver: { optimal: "Proved optimum for this single lineup", feasible: "Feasible · optimum unproved", infeasible: "No feasible lineup under these rules", conflict: "Selected player conflicts with the saved rules", unresolved: "Unresolved within the time limit", invalid: "Failed independent validation", not_evaluated: "Not evaluated" },
  failure: "Comparison failed. Your build and previous comparison remain available.", stale: "Inputs changed. Run a new comparison on the reviewed build.", mismatch: "Comparison does not match the frozen build inputs.",
  saveReview: "Download personal review", reopen: "Open saved review", savedTitle: "Saved Showdown review", savedScope: "Historical record · imported authenticity unverified. Current build and entry assignments are unchanged.", closeSaved: "Close saved review", reviewInvalid: "This is not a supported Showdown personal review. The current build is unchanged.",
  downloadAccess: "Sign in again before saving this personal review.", snapshot: "Original snapshot", noComparisons: "No saved comparison", beforeBuild: "Build status is retained with the original inputs.",
  availabilityFailed: "Current player status could not be checked. Retry before downloading this Showdown file.", unavailableExport: names => `Current unavailable status: ${names}. Keep this historical review; rebuild before downloading an entry file.`, elapsed: seconds => `${seconds}s elapsed`,
  previous: "Previous", next: "Next",
  warningPairs: "Pairs flagged for review",
  builtCount: count => `${count} ${count === 1 ? "lineup" : "lineups"}`,
  conditioningLabels: { conditional_active: "If active", scenario_mixture: "Availability scenarios", user_scenario: "Your availability scenario", unknown: "Unknown" },
};

export const DFS_FLOW_COPY = {
  title: "Build your lineups", workspace: "DFS workspace", goal: "Scoring goal",
  advanced: "Advanced rules", advancedHint: "Player limits · stacks · salary",
  choose: "Choose players", research: "Compare & research", optional: "Optional",
  recovery: "Save & restore", importInputs: "Import player estimates",
  schedule: (season, week) => `${season || "Season"} · Week ${week || "—"}`,
  playerChoices: (locks, skips) => [locks ? `${locks} locked` : "", skips ? `${skips} skipped` : ""].filter(Boolean).join(" · ") || "Optional",
  buildSummary: (locks, skips, salary) => [locks ? `${locks} locked` : "", skips ? `${skips} skipped` : "", salary != null ? `Maximum salary $${Number(salary).toLocaleString()}` : "PPR scoring"].filter(Boolean).join(" · "),
  built: "Lineups built", unique: "Unique lineups", appearances: "Player appearances",
  appearancesHelp: "How often each player appears in this build.",
  ready: "Ready to download?", downloadHelp: "Review your set, then choose the file you need.",
  continue: "Continue to download", adjust: "Adjust & build again", backReview: "Back to review",
  newCsv: "Download for My Lineups", games: "Games to stack", gameHelp: "What does this change?",
  gameHint: "More weight means more quarterback stacks from that game. Players are not locked.",
  marketDetails: "Game lines & details", total: "Total", spread: "Spread",
};

export const DFS_WORKFLOW_COPY = {
  journey: "Build, review & download", stages: ["Build", "Review", "Download"], portfolio: "Portfolio",
  requested: "Lineups requested", generated: "Lineups built", selected: "Lineups selected", unique: "Unique lineups", assigned: "Entries assigned",
  buildDetails: "Build details", reviewCount: n => ` · ${n}`,
  generate: n => `Build ${n} lineups`, review: "Review portfolio", entries: "Review entries", firstBatch: "Reviewed build",
  noPool: "Choose a slate or import its salary CSV before building.", countBlocked: "Enter a whole lineup count from 1 to 150.",
  buildBusy: "Build request in progress", elapsed: seconds => `${seconds}s elapsed`, cancelBuild: "Cancel build",
  cancelHelp: "Cancel stops waiting and discards this response. The server may finish its bounded work. Your previous result stays available.",
  jobs: { complete: "Build complete", partial: "Partial result · review count and constraints", failed: "Build failed · previous result retained", cancelled: "Build cancelled · previous result retained" },
  buildRetained: n => `${n} previous lineups remain available.`, buildError: "Build needs attention",
  solver: "Last returned selection", solverStatus: "Returned solver status", candidates: "Candidates", bound: "Bound", gap: "Gap", runtime: "Runtime (seconds)",
  prelockReplacement: "Review replacement history before checking pre-lock export.",
  unknown: "Unavailable", projectionScope: "Projection-guided selection within the returned candidate pool. No contest-return estimate or all-lineup optimality claim.",
  capabilities: "Data & capabilities", capabilityLabels: { identity: "Player & salary catalog", forecasts: "Player forecasts", roles: "Role recommendations", joint: "Joint game outcomes", field: "Opponent field", returns: "Contest-return estimates", entries: "Entry-update file", lateSwap: "Late swap", acceptance: "Platform acceptance" },
  capabilityStates: { available: "Available", partial: "Partial coverage", missing: "Inputs required", unavailable: "Unavailable", blocked: "Needs correction", review: "Review required", ready: "Ready to create", unconfirmed: "Unconfirmed" },
  capabilityHelp: "Player forecast sums support construction. Player ranges are not a lineup range. Missing research capabilities stay unavailable; a created file requires your upload and platform confirmation.",
  updateReady: "New player inputs are ready to compare. Your controls and reviewed lineups are unchanged.", salaryReady: "Salary file parsed. Review the catalog and control reset before using it.",
  draftResumed: "Working draft restored. Recheck current status before downloading.",
  updateTitle: "Review player input update", updateVersion: (a, b) => `Input version ${a} → ${b}`,
  updateCount: n => `${n} affected player${n === 1 ? "" : "s"}`, updateScope: "Apply updates the working player pool for a future build. Reviewed lineups and their original forecasts stay frozen. Imported player overrides remain in force for a live refresh.",
  catalogReset: "This salary import changes the working catalog. Apply also clears locks, skips, imported estimates, stack selections and build-plan controls. Your reviewed portfolio stays frozen.",
  affected: "Affected player", changedInputs: "Changed inputs", before: "Before", after: "After", applyUpdate: "Use reviewed inputs", keepInputs: "Keep current inputs", undoUpdate: "Undo input update",
  previousChanges: "Previous input changes", nextChanges: "Next input changes",
  updateKinds: { added: "Added", removed: "Removed", changed: "Changed" }, metadataChanged: "The salary snapshot identity also changed.",
  updated: "Working inputs updated. Reviewed lineups retain their original inputs; build again to evaluate the update.", updateKept: "Current inputs kept. The reviewed portfolio is unchanged.", updateUndone: "Previous working inputs restored as a new version. Reviewed lineups are unchanged.",
  appliedUpdate: "Input change record", undoneUpdate: "Update undone", staleUpdate: "The pool changed after this preview. Check for an update and review it again.", staleUndo: "Work changed after this version. Review a fresh replacement or restore its backup before changing it.",
  invalidPool: "The player update has an invalid catalog. Retry the update.", repeatedPoolIdentity: "The player update contains missing or repeated identities. Keep the current inputs and retry.",
  replaced: "Reviewed portfolio replacement applied. Import a fresh entry template before downloading.", replacementUndone: "Previous portfolio version restored. Import a fresh entry template before downloading.",
  exportTitle: "Entry-update review", exportScope: "Updates only the entries you assign. Unrelated template rows stay intact. Upload the downloaded file to DraftKings; acceptance remains unconfirmed.",
  downloadReviewed: "Download reviewed entry-update CSV",
  backupWorking: "Preparing portfolio backup…",
  templateMissing: "Import your reserved-entry template to choose the contest and assign lineups.", prelockMissing: "Check the slate and player start times, then confirm the pre-lock review below.",
  metrics: { "Projected Points": "Projected points", "Low (P10)": "Player P10", "High (P90)": "Player P90", salary: "Salary", dfs_id: "Platform ID", Player: "Name", Position: "Position", Team: "Team", Opponent: "Opponent", projection_source: "Forecast source", "Injury Status": "Status", on_bye: "Bye" },
};

export const DFS_GUARDRAIL_COPY = {
  groups: "Pair & core controls", groupHelp: "Choose 2–9 players. An appearance counts only when every member is in the same lineup, across any slots. Bounds apply to the next global build; existing lineups stay as built.",
  groupLabel: "Combination label (optional)", memberSearch: "Find a combination member", members: "Combination members",
  selectedMembers: n => `${n} of 9 members selected`, addGroup: "Add combination", remove: "Remove", removeGroup: label => `Remove combination: ${label}`,
  memberError: "Choose 2 to 9 players before adding this combination.", duplicateGroup: "This combination already has controls. Edit its existing bounds.",
  noGroups: "No combination bounds set. Pair concentration remains visible in the structure audit.",
  groupBound: (kind, label) => `${({ min: "Minimum", target: "Target", max: "Maximum" })[kind]} combination: ${label}`,
  stackHelp: "Rules apply to each selected quarterback. Existing locked players count. Same-team attachments include WR/TE and only the receiving RBs you select below. Opposing players include RB/WR/TE; defense never counts.",
  attachments: "Same-team attachments", bringBack: "Opposing players", stackCount: "Player count",
  modes: [{ id: "minimum", label: "At least" }, { id: "maximum", label: "At most" }, { id: "exact", label: "Exactly" }, { id: "optional", label: "Optional" }, { id: "forbidden", label: "Forbidden" }],
  semantics: (rule, section) => {
    const subject = section === "attachments" ? "qualifying same-team attachments" : "opposing offensive players";
    return rule.mode === "optional" ? `${subject}: neither required nor banned.` : rule.mode === "forbidden" ? `No ${subject} allowed.` : `${({ minimum: "At least", maximum: "At most", exact: "Exactly" })[rule.mode]} ${rule.count} ${subject}.`;
  },
  receivingRbs: "Qualifying receiving RBs", rbHelp: "Your explicit eligibility choice, not a modeled receiving-role recommendation. Other RBs do not count as same-team attachments. This does not lock selected RBs.",
  rbSearch: "Find a receiving RB", noRbs: "No eligible running backs match this search.", rbSelected: n => `${n} receiving RB${n === 1 ? "" : "s"} selected`,
  actualStacks: "Actual stack structure", unknown: "Unknown", actualCounts: (label, counts) => `${label}: ${Object.entries(counts).map(([size, n]) => `${size} players in ${n} lineups`).join(" · ")}`,
  plans: "Named build plans", planHelp: "Download your next-build controls as a plan, or import one for this exact slate. Preview first; Apply replaces locks, skips, schedule and strategy controls together. It does not rebuild or replace your existing lineups.",
  planName: "Plan name", downloadPlan: "Download build plan", importPlan: "Import build plan", applyPlan: "Apply reviewed plan", cancelPlan: "Keep current controls",
  preview: "Plan preview", planChanges: "Controls that will change", unchanged: "All controls already match this plan.",
  approved: label => `Applied plan: ${label}`, changed: "Controls differ from the applied plan. Reapply its preview or release the plan before building.",
  release: "Use edited controls", releaseHelp: "Releases the plan match requirement. Your current controls remain and are saved with the next build.",
  planReady: "Applied controls match the plan. The same match is checked again before Build.", planReadError: "This plan could not be read. Your controls have not changed.",
  planContext: (n, locked, excluded, groups) => `${n} lineups · ${locked} locks · ${excluded} skips · ${groups} combinations`,
  legacyRequired: "This plan requires at least one same-team WR/TE. Choosing an attachment count replaces that requirement.",
  fields: { portfolio_mode: "Builder mode", lineup_count: "Lineup count", objective: "Score preference", salary_cap: "Salary cap", min_salary: "Minimum spend", max_per_team: "Team maximum", max_overlap: "Maximum shared players", max_exposure: "Shared exposure maximum", randomness: "Search variation", locked_player_ids: "Locks", excluded_player_ids: "Skips", qb_stack_count: "Legacy attachments", require_qb_stack: "Legacy required attachment", stack_bring_back: "Legacy bring-back", stack_teams: "Quarterback teams", stack_qb_ids: "Quarterbacks", stack_game_weights: "Game allocation schedule", classic_stack_rules: "Exact stack rules", player_exposure_limits: "Player exposure controls", group_exposure_limits: "Combination controls", block_qb_opposing_dst: "QB/defense safeguard" },
};

export function buildPlanValue(field, value, pool = []) {
  const name = id => pool.find(p => p.player_id === id)?.Player || id;
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (["locked_player_ids", "excluded_player_ids", "stack_qb_ids"].includes(field)) return value.length ? value.map(name).join(", ") : "None";
  if (field === "stack_game_weights") return value.length ? value.map(g => `${g.teams.join(" / ")}: ${g.weight}`).join("; ") : "No weighted schedule";
  if (field === "classic_stack_rules") return `${DFS_GUARDRAIL_COPY.semantics(value.attachments, "attachments")} ${DFS_GUARDRAIL_COPY.semantics(value.bring_back, "bring_back")} Receiving RBs: ${value.attachments.receiving_rb_ids.map(name).join(", ") || "none"}.`;
  if (field === "player_exposure_limits") return Object.entries(value).map(([id, rule]) => `${name(id)}: ${buildPlanBounds(rule)}`).join("; ") || "None";
  if (field === "group_exposure_limits") return value.map(g => `${g.player_ids.map(name).join(" + ")}: ${buildPlanBounds(g)}`).join("; ") || "None";
  if (field === "max_exposure" || field === "randomness") return `${Number(value) * 100}%`;
  if (field === "salary_cap" || field === "min_salary") return `$${Number(value).toLocaleString()}`;
  return Array.isArray(value) ? value.join(", ") || "None" : String(value);
}
function buildPlanBounds(rule) {
  return ["min", "target", "max"].filter(k => rule[k] != null).map(k => `${({ min: "minimum", target: "target", max: "maximum" })[k]} ${typeof rule[k] === "object" ? `${rule[k].count} appearances` : `${Number(rule[k]) * 100}%`}`).join(", ") || "No bounds";
}

export const DFS_GLOBAL_COPY = {
  title: "Player & group limits", enabled: "Apply limits across the whole build", legacy: "Off uses the standard builder. On applies the limits below to the whole set.",
  help: "Set how often each player can appear in the next build. Any minimum or maximum you set is a firm limit; target is a preference.",
  search: "Find a player", unit: "Show limits as", percent: "Percent", count: "Appearances", minimum: "Minimum", target: "Target", maximum: "Maximum", actual: "Actual",
  rounding: "Minimums round up; maximums round down. Counts use your requested total. Changing units keeps the same target count.",
  overlap: "Maximum shared players",
  nativeMigration: "Your existing stack minimum and opposing-player requirement were transferred to the exact Classic controls. Forecasts are unchanged.",
  ruleCount: (n, total) => `${n} of ${total}`, actualCount: (n, total) => `${n} of ${total} generated`,
  clear: "Clear global controls", noPlayers: "No players match this search.", lock: "Locked everywhere", skip: "Skipped",
  block: "Avoid QB against opposing defense", blockHelp: "Classic strategy safeguard. Turn off only when you intend this pairing; the choice is saved with the build.",
  summary: (s) => `${s.selected_count} of ${s.requested_count} selected · ${s.unique_count} unique · ${s.candidate_count} candidates · ${s.solver_status}`,
  candidateNote: "Projection-guided candidate-pool selection. This does not estimate tournament returns or prove optimality over every legal lineup.",
  targetMiss: (id, count, target) => `${id}: actual ${count}; target ${target}.`,
  share: "Share", actualPages: "Actual exposure pages", lineupPages: "Lineup pages",
  structure: "Pairs & FLEX structure", pair: "Pair", appearances: "Appearances", rbPairs: "Running-back pairs", pairNote: "Repeated pairs count across every slot. There is no universal safe pair percentage.",
  flex: (counts, total) => `FLEX: ${counts.RB} RB · ${counts.WR} WR · ${counts.TE} TE of ${total}. Concentration is a review signal, not a ban.`,
  synced: "CSV created · history synchronized · acceptance unconfirmed", pending: "History sync pending. Your validated CSV and portfolio remain available. A download does not confirm platform acceptance.",
  syncReady: "History synchronized. Download the entry-update CSV when ready. Acceptance is unconfirmed.",
  formulaNotice: "This template contains formula-like metadata. Those original cells are preserved; review them before opening the file in spreadsheet software.",
  staleExport: "The entry review changed while preparing this file. Review assignments and download again.",
  recovery: "Download local recovery CSV", retry: "Retry history sync", manifest: "Download export audit", syncing: "Preparing entry-update CSV…", download: "Download DraftKings entry-update CSV",
  authorization: "Sign in again before downloading. Account access must be checked even for local recovery.",
  localTitle: "Local draft", localHelp: "Saved on this browser for this account. Restore reviews original inputs and clears entry assignments; import a fresh entries template.",
  localSaved: "Local draft saved", localSaving: "Saving local draft…", localError: "Local draft could not save. Download a backup before leaving.", localAvailable: "A local draft is available to recover.", localRestore: "Restore local draft", localDiscard: "Delete local draft", localEmpty: "No local draft saved yet.",
  localRestoreChanged: "The account or draft changed while restoring. Review the current account’s draft and restore again.",
  contest: "Entries to update", allContests: "Choose a contest", selectedContest: (name, count) => `${name} · ${count} reservations`,
  prelock: "I checked the slate and start time; none of the assigned players have locked.",
  prelockHelp: "Platform lock state is unverified. Known scheduled starts block this pre-lock export; check your entries on DraftKings before continuing.",
  weightConflict: "Global selection cannot apply a weighted batch schedule yet. Clear game weights or turn off global selection before building.",
};

export const DFS_PORTFOLIO_COPY = {
  title: "Saved lineups", label: "Batch label", add: "Add current build to portfolio", remove: "Remove batch",
  saveRestore: "Save & restore", saveSet: "Save this set", batchDetails: "Build batches & details",
  clearLimits: "Clear appearance limits",
  help: "Collect approved DraftKings Classic builds with their original inputs. Download a backup before leaving to restore this collection later.",
  backup: "Download portfolio backup", restore: "Restore portfolio backup",
  backupHelp: "Backups keep original inputs and appearance limits. Restore replaces the collection and requires a fresh Edit Entries template. Imported snapshots are historical records, not proof of ownership or authenticity.",
  backupInvalid: "This portfolio backup is malformed or contains unsupported data. The current portfolio has not changed.",
  backupVersion: "This file is not a supported version of a Classic portfolio backup. The current portfolio has not changed.",
  backupSize: "Portfolio backups must be 20 MiB or smaller. The current portfolio has not changed.",
  backupExpanded: "This backup exceeds the expanded recovery limit. The current portfolio has not changed.",
  replaceTitle: "Replace Classic portfolio?", replace: "Replace portfolio", cancelRestore: "Keep current portfolio",
  replaceMessage: (current, audit) => `Replace ${current} current batches with ${audit.batchCount} backup batches (${audit.total} lineups, ${audit.duplicates.length} duplicates, ${audit.errors.length} appearance-limit warnings)? This clears the current Edit Entries template and assignments. No batches will be merged.`,
  restored: "Portfolio restored with its original inputs and limits. Review the audit and import a fresh Edit Entries template before exporting.",
  auditHelp: "Appearances count every collected lineup, including locked players and duplicates. Maximum counts only block portfolio export; they do not change builds.",
  empty: "Build your lineups, or restore a saved set below.", emptyWithBuild: "Save this set to review player limits and download a backup.", player: "Player", count: "Appearances", countHeading: "Count", percent: "%", qb: "At QB", qbHeading: "QB", batches: "Batches", maximum: "Maximum appearances (optional)", maxHeading: "Max",
  progress: (unique, total, batches, duplicates, shortfall) => `${unique} / 150 unique · ${total} collected · ${batches} ${batches === 1 ? "batch" : "batches"} · ${duplicates} duplicates · ${shortfall} shortfall`,
  batchSummary: (label, count, time) => `${label} · ${count} lineups · ${time}`,
  duplicate: (first, index, batch) => `${batch}: lineup ${index + 1} repeats portfolio lineup ${first + 1}.`,
  classicOnly: "Portfolio collection and export support DraftKings NFL Classic only.",
  buildFirst: "Build and collect lineups with their original salary catalog first.",
  labelRequired: "Enter a batch label before adding this build.",
  missingIdentity: "A lineup is missing a canonical player ID. Rebuild before collecting it.",
  incompatible: "This batch has a different site, slate, week or salary catalog. Remove the other batches to start a different portfolio.",
  invalidLimit: "Maximum appearances must be a whole number of zero or more, or blank for no limit.",
  limitExceeded: (player, count, max) => `${player}: ${count} appearances exceeds the maximum of ${max}.`,
  duplicateBlock: "Remove batches containing duplicate lineups before exporting. No lineups are removed automatically.",
  countMismatch: (selected, total) => `Select exactly ${total} reserved entries for ${total} portfolio lineups. Currently selected: ${selected}.`,
  assignmentRepeat: "Assign each portfolio lineup exactly once. Repeated or missing assignments block export.",
  missingBuild: "An original batch could not be saved. Retry before exporting.",
  source: "Reserved-entry lineup source", currentBuild: "Current build", portfolio: "Reviewed portfolio",
  export: "Download DraftKings entry-update CSV", exporting: "Preparing entry-update CSV…",
  selected: (selected, total) => `${selected} selected entries · ${total} portfolio lineups`,
  assignment: (index, label, originalIndex) => `Portfolio ${index + 1} · ${label} · lineup ${originalIndex + 1}`,
};

export const DFS_WORKSPACE_COPY = {
  countHelp: "Enter a whole number from 1 to 150.",
  poolStatus: "Player status", available: "Available", allPlayers: "All players", unavailable: "Unavailable", missingInputs: "Needs estimates",
  availableCount: n => `${n} player${n === 1 ? "" : "s"} available`, unavailableCount: n => `${n} unavailable`, missingCount: n => `${n} ${n === 1 ? "needs" : "need"} estimates`,
  coverageHelp: "Available players have complete estimates and are not flagged unavailable. Your locks, skips and limits still apply.",
  missingTitle: "Players needing estimates", missingEmpty: "No players are waiting on estimates.",
  missingReasons: { team_conflict: "Team differs between salary and roster feeds.", position_conflict: "Position differs between salary and roster feeds.", missing_or_invalid_projection: "A projection, floor or ceiling is missing." },
  sourceTitle: "Where estimates come from", sourceScope: "Available players in this pool.",
  sourceDescriptions: { ScoreSense: "Player and defense models", "Roster estimate": "Profile when player history is missing", "Historical estimate": "Past team kicking ranges", "Fixed estimate": "Fixed values, not a player model", Imported: "Your imported values", Other: "Source not identified" },
  sourcesEmpty: "No available players with complete estimates.", range: "P10–P90", rangeHint: "Player range, not a lineup floor or ceiling",
  bye: "Bye", freshnessLoadFailed: "Player pool could not load", freshnessLoading: "Checking player pool…", freshnessUnknown: "Refresh status unavailable", freshnessFailed: "Pool update failed · showing previous inputs",
  freshnessStale: "Projection refresh overdue or failed", freshnessPending: "Player pool not checked yet", freshnessHistorical: "Refresh status is for another week",
  uploadedPool: "Uploaded pool · original inputs", uploadedPoolHelp: "Choose a live slate to resume automatic checks.",
  checkedAt: time => `Pool checked ${time}`, projectionsAt: time => `Projections refreshed ${time}`,
  refreshCadence: minutes => `Checks every ${minutes} min while visible`, originalInputs: "Built and saved lineups keep their original inputs.",

  projectionRefreshFailed: "The player pool was checked, but the projection refresh is overdue or failed. Existing estimates remain available; review them before building.",
  liveRefreshed: "Live player pool checked. Built lineups keep their original inputs; rebuild to use the latest pool. Imported estimates stay in place.",
  liveRefreshFailed: "The live player pool could not refresh. Showing the previous inputs; the next check is in five minutes.",
  captainRotationHelp: "Lineups may use the same six players with a different Captain. Repeated lineups are excluded; exposure limits still apply.",
  dataUpdate: "New projections are available. Compare the player input update before using it; reviewed lineups keep their original values.",
  updatePool: "Check player update",
  uploadedUpdate: "New projections are available. Your uploaded player pool keeps its original estimates; choose a live slate to use the update.",
  eyebrow: "Tournament workspace", title: "Your lineups, built together.", support: "Choose your pool. Control your exposure. Review the whole set.",
  build: "Build lineups", results: "Results", settings: "Build settings", contest: "Contest", contestNote: "Projection-based construction. Contest-return estimates are not available.",
  format: "Format", slate: "Slate", season: "Season", week: "Week", count: "Lineups", goal: "Score to optimize", captain: "Locked Captain", anyCaptain: "Choose from the pool", captainLimit: "Captain max", noCaptain: "No Captain", exposure: "Max appearances per player", differences: "Minimum different players", salary: "Salary range", min: "Minimum salary", max: "Maximum salary", stacks: "Stacking & other rules", qbStack: "Pass catchers per QB", bringBack: "Include an opposing receiver", maxTeam: "Max players per team", jitter: "Projection variation", jitterNote: "Variation changes the input scores between builds. It is not a game simulation.", lockNote: "Locked players appear in every lineup. Other limits count toward the requested set; the Exposure tab shows actual usage.",
  pool: "Player pool", exposureTab: "Exposure", notes: "Build notes", search: "Search players…", player: "Player", proj: "Proj.", own: "Own.", actions: "Actions", lock: "Lock", skip: "Skip", clear: "Clear locks and skips", noPlayers: "No players match these filters.", projections: "Import projections & ownership", salaryImport: "Import salary CSV", projectionHelp: "CSV columns: ID, Proj, Floor, Ceiling, optional Ownership (0–100). Use this slate’s FLEX IDs and base points, before Captain multipliers.", missingOwnership: "Ownership not loaded. Duplication and contest-return estimates are unavailable.", missingProjection: "Missing estimates are excluded from builds. Historical estimates use past scoring ranges; roster estimates use a player profile when individual history is missing. These are labeled separately from modeled projections.",
  estimates: "Player estimates", importEstimates: "Import projections", importFormat: "CSV format & sources", sourceCount: (source, count) => `${source} · ${count}`, noEstimateSources: "No complete estimates loaded", importSource: name => `Imported file: ${name}`, importEffect: "Imports replace estimates for matched players. Build again to use them; reviewed lineups keep their original values.",
  selected: "Selected lineup", empty: "Load a slate, choose your settings, and build your first lineup.", saved: "Saved with original inputs", save: "Save build for review", saveHelp: "Keeps this build’s original inputs for Results.", savedHelp: "Open Results to link an entry after scoring.", used: "Salary used", unused: "Unused", rebuild: "Rebuild lineups", building: "Building…", lineupsTitle: "Your lineups", viewLineups: (n) => `View ${n} lineup${n === 1 ? "" : "s"}`, notesLabel: "Your game script and pregame reasoning", notesHelp: "These notes are saved with the build. They do not change the source projections.",
  newLineups: "New lineups", upload: "Upload to My Lineups", uploadHelp: "A lineup CSV creates lineups. It does not enter a contest or edit reserved entries.", download: "Download lineup CSV", detail: "Download detail CSV", existing: "Reserved entries", edit: "Update existing entries", editHelp: "Import the CSV from DraftKings’ Edit Entries page, then review which lineup goes into each entry.", template: "Import Edit Entries CSV", assignment: "Entry assignments", keep: "Keep current lineup", sequential: "Assign lineups in order", entryDownload: "Download Edit Entries CSV", verifySlate: "I checked that this template is for the same slate and start time.", restriction: "If upload succeeds but entry is blocked, record the exact message, contest ID and time for DraftKings support. Export checks cannot verify account eligibility.",
  imported: "Imported", previous: "Previous", next: "Next", total: "Total", captainCount: "Captain", all: "All", loading: "Loading player pool",
};

export const DFS_RESULTS_COPY = {
  requestFailed: "The request could not be completed.",
  notJson: (url, status) => `The server returned a page instead of data for ${String(url).split("?")[0]} (${status}). Reload the page; if it keeps happening the API is not answering.`,
  fileLimit: "Import a CSV or ZIP up to 100 MB. The CSV inside a ZIP must also be under 100 MB.",
  invalidZip: "This ZIP could not be read. Download the contest export again or upload the extracted CSV.",
  zipCsvCount: "Choose a ZIP containing one results CSV, or upload the extracted CSV directly.",
  zipContestMismatch: "The ZIP and CSV filenames have different contest IDs. Upload the extracted CSV and review its contest ID.",
  standingsSite: "This is a DraftKings standings export. Choose DraftKings as the site.",
  standingsFinance: "Contest standings contain scores and lineups, not fees or payouts. Choose Scores and lineups.",
  scoresOnly: "Fees and payouts are not included.",
  usernameRequired: "Enter your DraftKings username, or import your contest history first so we can match your entry IDs.",
  noMatchingEntries: "No entries matched. Check your DraftKings username or import your contest history first.",
  username: "Your DraftKings username",
  standingsHelp: "This file contains the whole contest. Enter your DraftKings username to select your entries. Leave it blank to match entries already in your results. Fees and payouts come from contest history.",
  detectedContest: (id) => `Contest ${id} detected from the filename.`,
  selectedEntries: (selected, total) => `${selected.toLocaleString()} of ${total.toLocaleString()} contest entries selected.`,
  chooseFile: "Choose the CSV again before previewing.",
  reading: "Reading CSV…",
  validating: "Checking entries…",
  importing: (saved, total) => `Saving entries: ${saved.toLocaleString()} of ${total.toLocaleString()}…`,
  importInterrupted: (saved, total, reason) => `Import interrupted. ${saved.toLocaleString()} of ${total.toLocaleString()} entries confirmed saved. Retry to finish; existing entries will be updated without duplicates. ${reason}`,
  savedImport: (total) => `${total.toLocaleString()} entries saved.`,
  previous: "Previous entries",
  next: "Next entries",
  entryPage: (page, pages) => `Page ${page} of ${pages}`,
  contestReport:Object.freeze({
    title:"Contest breakdowns",
    help:"The standings file DraftKings gives you after a contest. It holds every entry, every lineup, and what the whole field owned.",
    pick:"Import contest standings",
    clear:"Clear",
    notStandings:"That is not a contest-standings file. Download the standings export from the contest page.",
    username:"Your DraftKings username",
    usernamePlaceholder:"username",
    usernameHelp:"Marks which entries are yours. Leave blank to read the field only.",
    prizes:"Payout table",
    prizesPlaceholder:"1st\t$1,000.00\n2nd\t$500.00\n3rd - 5th\t$200.00",
    prizesHelp:"Paste it from the contest page. Standings files carry no prize money, so without this the payout column stays empty. Ties are pooled and split the way DraftKings does.",
    viewMine:"My entries",
    viewField:"Whole field",
    entries:"Entries",
    unique:"Unique lineups",
    scoreRange:"Score range",
    scoreMedian:"Median score",
    paid:"Entries in the money",
    rank:"Rank",
    points:"Points",
    payout:"Payout",
    percentile:"Beat",
    duplicates:"Shared by",
    player:"Player",
    slot:"Slot",
    fieldOwn:"Field",
    mineOwn:"Mine",
    leverage:"Leverage",
    fpts:"Actual",
    noPrizes:"Add a payout table to see money.",
    noneMine:"No entries matched that username.",
    duplicateNote:"Other entries with this exact lineup.",
    leverageNote:"Your exposure minus the field\u2019s. Captain and flex are counted separately, the way DraftKings reports them.",
    winnersOwn:"Winners",
    chartNoPlayers:"This file has no player table, so there is nothing to chart. Download the standings export again from the contest page.",
    scatterTitle:"Ownership against what they actually scored",
    scatterHelp:"Every player on the slate. Both numbers come from the file \u2014 nothing here is a projection.",
    scatterX:"Rostered by the field",
    scatterY:"Actual points",
    keyMine:"In your lineups",
    keyRest:"Everyone else",
    scatterRead:"The dashed lines are the field\u2019s median ownership and median points. Top left is where tournaments are won \u2014 players who scored while most of the field was somewhere else. Bottom right is chalk that missed.",
    winnersTitle:"What the winners played",
    winnersScope:(entries,rank,topPct)=>`The top ${entries.toLocaleString()} entries \u2014 rank ${rank.toLocaleString()} and better, about the top ${topPct}% of the field.`,
    winnersWholeField:(entries)=>`This field is only ${entries.toLocaleString()} entries, so the winners group is the whole field. Nothing below separates winners from anyone else.`,
    winnersCaptain:(player,winnersPct,fieldPct)=>`${player} captained ${winnersPct} of the winners against ${fieldPct} of the field.`,
    keyWinners:"Winners",
    keyField:"Whole field",
    winnersRead:"A filled bar far past its outline is a player the winners were on and the field was not. Captain and flex are separate rows.",
    duplication:"Lineups played more than once",
    yourEntries:"Your entries",
    yourPayout:"Your payouts",
    bestFinish:"Your best finish",
    tablesTitle:"The numbers behind the charts",
    tablesHelp:"Two tables over the same file. Pick which one you want.",
    fee:"Entry fee",
    feePlaceholder:"$3.00",
    feeHelp:"What one entry cost. The standings file carries no fee, so without this your net profit and ROI stay blank.",
    date:"Contest date",
    dateHelp:"The standings file carries no date either, and undated money cannot be plotted \u2014 this is what puts the contest on the spend-against-payouts chart. It starts on the date already on record for this contest, or today.",
    save:"Save to my results",
    saving:"Saving…",
    saveHelp:(entries)=>entries?`Writes the payout, rank and score onto your ${entries.toLocaleString()} ${entries===1?"entry":"entries"} in Results, and keeps this breakdown so you can reopen it without the CSV.`:"Keeps this breakdown so you can reopen it without the CSV. No entries of yours matched, so nothing is written to your results ledger.",
    savedTo:(entries)=>entries?`Saved. ${entries.toLocaleString()} ${entries===1?"entry":"entries"} updated in Results, and the breakdown is under Saved contests.`:"Saved. The breakdown is under Saved contests.",
    saveNeedsId:"This file has no contest ID in its name, so there is nothing to file it under. Use the standings export straight from DraftKings.",
    saveNeedsAccount:"Sign in to save a contest to your results.",
    savedList:"Saved contests",
    savedListHelp:"Reopen a breakdown without the CSV. The payout table and entry fee are kept with it.",
    open:"Open",
    forget:"Forget",
    forgetConfirm:"Forget this saved breakdown? The entries in your results stay, and the original CSV is untouched.",
    frozen:"A saved breakdown. Import the standings file again to change the payout table or the fee.",
    backToImport:"Import a different contest",
  }),
  title:"See what your lineups earned.",support:"Track the money. Review the decisions behind it.",history:"Import contest history",scores:"Import lineup results",fees:"Entry fees",payouts:"Payouts",net:"Net profit",roi:"ROI",chart:"Returns over time",cumulative:"Cumulative \u00b7 settled cash entries",sample:"Returns describe the imported sample. A profitable period alone does not establish a lasting edge.",empty:"Import contest history to see your entry fees and payouts, or break down a contest below and save it \u2014 that writes the money onto your entries too.",emptyTitle:"Nothing imported yet",inTheMoney:"In the money",bestFinish:"Best finish",contestCount:(n)=>`${n.toLocaleString()} ${n===1?"contest":"contests"}`,verdictScope:(entries,first,last)=>{const span=first&&last?(first===last?` on ${first}`:` from ${first} to ${last}`):"";return `${entries.toLocaleString()} settled ${entries===1?"entry":"entries"} with a fee and a payout on record${span}.`;},utility:"Import & coverage",fee:"Fee",payout:"Payout",entryNet:"Net",coverage:"Import coverage",matched:"Entries with complete finances",undated:"Settled entries without dates",unsettled:"Unsettled or void entries",groups:"Where did the returns come from?",group:"Group by",stack:"QB stacks",captain:"Captain",contest:"Contest",salary:"Salary left",count:"Entries",noGroups:"Import results or link a saved build to see lineup groups.",descriptive:"These groups describe your entries, not the whole field. Counts and fees matter when comparing returns.",review:"Review an entry",reviewHelp:"Every entry you have imported. Pick one to see how it scored, and link it to the build you saved before lock to compare what you projected with what happened.",reviewPick:"Pick an entry above to open it.",entry:"Entry",date:"Date",points:"Actual points",rank:"Rank",saved:"Saved builds",snapshot:"Original build snapshot",link:"Link saved build",none:"No saved build",lineup:"Lineup",saveLink:"Save link",notes:"Postgame notes",saveNote:"Save review note",projection:"Saved projection sum",difference:"Actual minus saved projection",compareHelp:"This compares the actual lineup total with the saved sum of player projections. It does not identify the cause of a miss.",noSnapshot:"Link this entry to a saved pregame build to compare projections and exposure.",before:"At build time",after:"After the game",journal:"Which assumptions held? Was a role change knowable before lock? Keep hindsight separate from the original decision.",importTitle:"Review your import",mapping:"Match CSV columns",unmapped:"Not in this file",site:"Site",kind:"Import type",historyKind:"Fees and payouts",resultsKind:"Scores and lineups",contestOverride:"Contest ID (if absent from the file)",settled:"These entries are settled",payoutHelp:"Payout must be the total credited cash prize, not net profit. Keep tickets, refunded and promotional entries out of this cash import.",preview:"Preview entries",saveImport:"Save imported entries",cancel:"Cancel import",remove:"Remove entry",removeConfirm:"Remove this entry from your results? The original CSV and saved build remain available.",all:"All sites",noChart:"Dated, settled cash entries will appear here.",partial:"Some settled entries have incomplete financial data. Totals cover complete entries only; ROI is unavailable.",
};

export const OBJECTIVES = [
  { id: "median", label: "Projected points", shortLabel: "Proj", hint: "Maximize the sum of player median projections" },
  { id: "floor", label: "Player floor inputs", shortLabel: "Floor", hint: "Maximize the sum of player P10 estimates; this is not a lineup floor" },
  { id: "ceiling", label: "Player ceiling inputs", shortLabel: "Ceiling", hint: "Maximize the sum of player P90 estimates; this is not a lineup ceiling or win probability" },
  { id: "value", label: "Points per salary dollar", shortLabel: "Value", hint: "Maximize points per salary dollar", dfsOnly: true },
];

export const DEFAULT_FORMATS = {
  seasonal: {
    label: "Season-long PPR",
    description: "1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX",
    salary_cap: null,
    base_site: null,
  },
  draftkings: {
    label: "DraftKings Classic",
    description: "QB · 2 RB · 3 WR · TE · FLEX · DST",
    salary_cap: 50000,
    base_site: "draftkings",
  },
  fanduel: {
    label: "FanDuel Classic",
    description: "QB · 2 RB · 3 WR · TE · FLEX · DST",
    salary_cap: 60000,
    base_site: "fanduel",
  },
  draftkings_showdown: {
    label: "DraftKings Showdown",
    description: "CPT (1.5× pts, 1.5× salary) + 5 FLEX",
    salary_cap: 50000,
    base_site: "draftkings",
    slate_category: "showdown",
    captain_label: "CPT",
  },
  fanduel_single: {
    label: "FanDuel Single game",
    description: "MVP (1.5× pts, 1.5× salary) + 5 FLEX",
    salary_cap: 60000,
    base_site: "fanduel",
    slate_category: "showdown",
    captain_label: "MVP",
  },
};

export const FORMAT_PERSONALITY = {
  seasonal: { icon: "S", note: "Best-effort PPR from weekly projections. No salary cap." },
  draftkings: { icon: "DK", note: "Classic 9-spot under a $50k cap." },
  fanduel: { icon: "FD", note: "Classic 9-spot under a $60k cap." },
  draftkings_showdown: { icon: "SD", note: "One game. The CPT slot pays 1.5× at 1.5× salary." },
  fanduel_single: { icon: "SG", note: "One game. The MVP slot pays 1.5× at 1.5× salary." },
};

export const SLATE_CATEGORIES = [
  { id: "main", label: "Main", hint: "Full weekend slate" },
  { id: "primetime", label: "Primetime", hint: "TNF, SNF, and MNF" },
  { id: "showdown", label: "Showdown", hint: "Single-game CPT + FLEX" },
  { id: "all", label: "All", hint: "Every posted slate" },
];

export const MAX_LINEUP_COUNT = 150;

export function parseLineupCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_LINEUP_COUNT
    ? count
    : null;
}

export const STACK_OPTIONS = [
  { id: 0, label: "Off", hint: "No stacking rule" },
  { id: 1, label: "QB +1", hint: "One same-team pass catcher with each QB" },
  { id: 2, label: "QB +2", hint: "Two same-team pass catchers with each QB" },
];

export const RANDOMNESS_OPTIONS = [
  { id: 0, label: "Off", hint: "Pure projections every build" },
  { id: 0.05, label: "Subtle", hint: "Small jitter for near-optimal variety" },
  { id: 0.12, label: "Medium", hint: "Tournament-style variety" },
  { id: 0.25, label: "Wild", hint: "Big swings for large entry counts" },
];

export const EXPOSURE_OPTIONS = [
  { id: 0, label: "No cap" },
  { id: 0.6, label: "60%" },
  { id: 0.5, label: "50%" },
  { id: 0.4, label: "40%" },
  { id: 0.3, label: "30%" },
  { id: 0.2, label: "20%" },
];

export const TEAM_LIMIT_OPTIONS = [
  { id: 0, label: "No limit" },
  { id: 4, label: "4 per team" },
  { id: 3, label: "3 per team" },
  { id: 2, label: "2 per team" },
];

/** Minimum-spend presets expressed as "salary left on the table". */
export const MIN_SPEND_OPTIONS = [
  { id: 0, label: "Any spend" },
  { id: 1000, label: "≤ $1,000 left" },
  { id: 500, label: "≤ $500 left" },
  { id: 200, label: "≤ $200 left" },
];

export function isCaptainFormat(siteId, formats = DEFAULT_FORMATS) {
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId];
  if (cfg?.captain_label) return true;
  return Boolean(cfg?.roster?.cpt);
}

export function captainLabel(siteId, formats = DEFAULT_FORMATS) {
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId] || {};
  return cfg.captain_label || "CPT";
}

export function defaultSlateCategory(siteId, formats = DEFAULT_FORMATS) {
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId] || {};
  return cfg.slate_category || "all";
}

export function slateProviderSite(siteId, formats = DEFAULT_FORMATS) {
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId] || {};
  return cfg.base_site || null;
}

export function formatSalary(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `$${Number(value).toLocaleString()}`;
}

export function rosterHint(site, formats = DEFAULT_FORMATS) {
  const cfg = formats[site] || DEFAULT_FORMATS[site] || DEFAULT_FORMATS.seasonal;
  return cfg.description || "";
}

export function formatPersonality(siteId, formats = DEFAULT_FORMATS) {
  const preset = FORMAT_PERSONALITY[siteId];
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId] || {};
  return {
    icon: preset?.icon || String(siteId || "?").slice(0, 2).toUpperCase(),
    note: preset?.note || cfg.description || "Build a valid lineup for this format.",
    label: cfg.label || siteId,
  };
}

export function filterObjectives(isDfs) {
  return OBJECTIVES.filter((objective) => !objective.dfsOnly || isDfs);
}

export function objectiveLabel(objectiveId, isDfs = true) {
  const match = filterObjectives(isDfs).find((objective) => objective.id === objectiveId);
  return match?.label || "Proj (P50)";
}

export const DFS_STEP_COPY = {
  formatTitle: "Choose the format",
  formatSupport: "Cap, captain, or season-long. Pick the one you are entering.",
  shootoutTitle: "Weight stacks by matchup",
  shootoutSupport: "Raise the games you want more often. Weight changes stack share — it never locks a player.",
  shootoutEmpty: "No Vegas lines for this week.",
  shootoutCaptain: "Captain mode fills from this game. The CPT slot is 1.5×.",
  clearGames: "Clear games",
  highestTotal: "Highest total",
  stackWeight: "Stack weight",
  weightShort: "Weight",
  impliedNote: "Numbers under each team are implied points.",
  impliedTitle: "Implied points",
  lowerWeight: "Lower stack weight",
  raiseWeight: "Raise stack weight",
  weightOff: "Off",
  weightOnNote: "Choosing a weight turns on QB +1 stacking when stacking is off.",
  lineupPlan: "Stack plan",
  noWeightedGames: "No matchup stacks selected.",
  lineupAllocation: (count) => `${count} lineup${count === 1 ? "" : "s"}`,
  closedSlate: "DraftKings is no longer returning salaries for this slate. It has likely locked or expired. The matchup board is still available; choose another live slate or import its salary CSV to build.",
  currentLine: "Current line",
  lineMoveNote: "Line moves compare the current consensus with the first line ScoreSense saw this week.",
  noMove: "No move",
  totalMove: (direction, from) => `${direction === "up" ? "Up" : "Down"} from ${from}`,
  spreadMove: (from) => `From ${from}`,
  stacksTitle: "Stacks from these games",
  stacksSupport: "Build takes a QB from the games you marked. Pin a stack only if you want that quarterback.",
  useStack: "Use this stack",
  stackInBuild: "In the build",
};

const TEAM_MATCH = Object.freeze({
  LAR: "LA",
  LA: "LA",
  WSH: "WAS",
  WAS: "WAS",
  JAC: "JAX",
  JAX: "JAX",
  LVR: "LV",
  LV: "LV",
  OAK: "LV",
});

const PASS_CATCHERS = new Set(["WR", "TE"]);
const SKILL_POSITIONS = new Set(["RB", "WR", "TE"]);

export function normalizeDfsTeam(team) {
  const raw = String(team || "").trim().toUpperCase();
  if (!raw || raw === "NAN" || raw === "NONE" || raw === "NULL") return "";
  return TEAM_MATCH[raw] || raw;
}

export function sameDfsTeam(left, right) {
  const a = normalizeDfsTeam(left);
  const b = normalizeDfsTeam(right);
  return Boolean(a && a === b);
}

export function gameStackLabel(game = {}) {
  const away = displayNflTeam(game.away);
  const home = displayNflTeam(game.home);
  if (away === "—" && home === "—") return "";
  return `${away} @ ${home}`;
}

export function slateGames(games = [], pool = []) {
  if (!games.length) return [];
  const teams = new Set(
    (pool || []).map((row) => normalizeDfsTeam(row.Team)).filter(Boolean),
  );
  if (!teams.size) return games;
  const matched = games.filter((game) => (
    teams.has(normalizeDfsTeam(game.home)) && teams.has(normalizeDfsTeam(game.away))
  ));
  return matched.length ? matched : games;
}

const STACK_QB_FLOOR = 6;

function stackMedian(row = {}) {
  return Number(row["Projected Points"]) || 0;
}

function stackRank(row = {}) {
  const median = stackMedian(row);
  if (median > 0) return median;
  const ceiling = Number(row["High (P90)"]);
  return Number.isFinite(ceiling) && ceiling > 0 ? ceiling : 0;
}

function stackRowOut(row = {}) {
  if (row.on_bye) return true;
  const status = String(row["Injury Status"] || row.injury_status || "").toLowerCase();
  return /(out|ir|pup|inactive|suspended)/.test(status);
}

export function stackRowEligible(row, { requireSalary = false } = {}) {
  if (!row || !row.player_id) return false;
  if (stackRowOut(row)) return false;
  if (requireSalary && (row.salary == null || row.salary === "")) return false;
  return true;
}

function normalizePos(value) {
  return String(value || "").trim().toUpperCase();
}

export function gameTeamCodes(game = {}) {
  return [normalizeDfsTeam(game.away), normalizeDfsTeam(game.home)].filter(Boolean);
}

function teamPlayers(pool, team, { requireSalary = false } = {}) {
  return (pool || []).filter((row) => (
    stackRowEligible(row, { requireSalary }) && sameDfsTeam(row.Team, team)
  ));
}

export function starterQb(pool, team, { requireSalary = false } = {}) {
  const qbs = teamPlayers(pool, team, { requireSalary })
    .filter((row) => normalizePos(row.Position) === "QB" && stackRank(row) >= STACK_QB_FLOOR)
    .slice()
    .sort((left, right) => stackRank(right) - stackRank(left));
  return qbs[0] || null;
}

export function listGameStacks(pool = [], game = {}, { stackCount = 2, requireSalary = false } = {}) {
  const home = normalizeDfsTeam(game.home);
  const away = normalizeDfsTeam(game.away);
  const sides = [away, home].filter(Boolean);
  const stacks = [];
  for (const team of sides) {
    const qb = starterQb(pool, team, { requireSalary });
    if (!qb) continue;
    const oppTeam = team === home ? away : home;
    const catchers = teamPlayers(pool, team, { requireSalary })
      .filter((row) => PASS_CATCHERS.has(normalizePos(row.Position)))
      .slice()
      .sort((left, right) => stackRank(right) - stackRank(left))
      .slice(0, Math.max(0, stackCount));
    const bring = teamPlayers(pool, oppTeam, { requireSalary })
      .filter((row) => SKILL_POSITIONS.has(normalizePos(row.Position)))
      .slice()
      .sort((left, right) => stackRank(right) - stackRank(left))[0] || null;
    stacks.push({
      id: `${game.game_id || "game"}:${team}:${qb.player_id}`,
      game,
      qb,
      stackTeam: team,
      oppTeam,
      catchers,
      bring,
      complete: catchers.length >= stackCount,
    });
  }
  return stacks.sort((left, right) => stackRank(right.qb) - stackRank(left.qb));
}

export function listSelectedGameStacks(pool, games = [], opts = {}) {
  return (games || []).flatMap((game) => listGameStacks(pool, game, opts));
}

export function pickGameStack(pool = [], game = {}, { stackCount = 2, requireSalary = false } = {}) {
  const listed = listGameStacks(pool, game, { stackCount, requireSalary });
  const stack = listed[0];
  if (!stack) {
    return { game, players: [], complete: false, stackTeam: "", oppTeam: "" };
  }
  const players = [
    { role: "qb", label: "QB", row: stack.qb },
    ...stack.catchers.map((row, index) => ({
      role: "stack",
      label: `${normalizePos(row.Position)} +${index + 1}`,
      row,
    })),
  ];
  if (stack.bring) players.push({ role: "bring", label: "Bring", row: stack.bring });
  return {
    game,
    stackTeam: stack.stackTeam,
    oppTeam: stack.oppTeam,
    players,
    complete: stack.complete && Boolean(stack.bring),
  };
}

export function stackOptionCopy(stack) {
  const qbName = String(stack?.qb?.Player || "").trim() || "QB";
  const team = displayNflTeam(stack?.stackTeam);
  const catcherNames = (stack?.catchers || [])
    .map((row) => String(row.Player || "").trim())
    .filter(Boolean);
  const bringName = String(stack?.bring?.Player || "").trim();
  const mates = catcherNames.length
    ? catcherNames.join(" · ")
    : "Thin on this board — Build still pulls the rest of the team.";
  return {
    title: `${qbName} · ${team}`,
    game: gameStackLabel(stack?.game),
    body: bringName ? `${mates}. Bring-back ${bringName}.` : mates,
  };
}

export function stackPlayerIds(stack) {
  return (stack?.players || [])
    .map((entry) => String(entry.row?.player_id || ""))
    .filter(Boolean);
}

export function replaceStackLocks(locked, previousIds = [], nextIds = []) {
  const next = new Set(Array.from(locked || [], (id) => String(id)));
  for (const id of previousIds) next.delete(String(id));
  for (const id of nextIds) {
    if (id) next.add(String(id));
  }
  return next;
}

export function dropLockId(ids, playerId) {
  const next = new Set(Array.from(ids || [], (id) => String(id)));
  next.delete(String(playerId || ""));
  return next;
}

export function vegasGameCta({ selected = false } = {}) {
  return selected ? "In the build" : "Add this total";
}

export function stackPreviewCopy(stack) {
  const label = gameStackLabel(stack?.game);
  if (!stack?.players?.length) {
    return {
      title: label ? `${label}` : "These games",
      body: "No starter QB on this slate for that game yet.",
    };
  }
  const stackName = displayNflTeam(stack.stackTeam);
  return {
    title: label || "These games",
    body: `${stackName} is one side. Pin a stack if you want that quarterback — Build does not lock him for you.`,
  };
}

export function stackApplyLiveText(stack) {
  const game = gameStackLabel(stack?.game);
  return game ? `${game} is in the build. No player locked.` : "Game is in the build. No player locked.";
}

export function stackClearLiveText() {
  return "Games cleared. Stacks from those totals are off.";
}

export function gamesMarkedCopy(count = 0) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n === 1 ? "1 game in the build" : `${n} games in the build`;
}

export function matchupWeightLabel(weight = 0) {
  const value = Math.max(0, Math.min(4, Number(weight) || 0));
  return value ? `${value}×` : DFS_STEP_COPY.weightOff;
}

export function allocateMatchupWeights(weights = {}, lineupCount = 0) {
  const entries = Object.entries(weights)
    .map(([gameId, weight]) => ({
      gameId,
      weight: Math.max(0, Math.min(4, Number(weight) || 0)),
    }))
    .filter((entry) => entry.weight > 0);
  const count = Math.max(0, Math.floor(Number(lineupCount) || 0));
  if (!entries.length || !count) return [];
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const rows = entries.map((entry) => {
    const exact = (entry.weight / totalWeight) * count;
    return { ...entry, count: Math.floor(exact), remainder: exact % 1 };
  });
  const left = count - rows.reduce((sum, entry) => sum + entry.count, 0);
  const order = rows
    .map((entry, index) => ({ index, remainder: entry.remainder }))
    .sort((leftEntry, rightEntry) => (
      rightEntry.remainder - leftEntry.remainder || leftEntry.index - rightEntry.index
    ));
  for (let index = 0; index < left; index += 1) {
    rows[order[index % order.length].index].count += 1;
  }
  return rows.map(({ gameId, weight, count: allocated }) => ({
    gameId,
    weight,
    count: allocated,
  }));
}

export function dfsHeroCopy({
  isDfs = true,
  siteLabel = "DraftKings Classic",
  captain = false,
} = {}) {
  if (isDfs && captain) {
    return {
      eyebrow: "DFS",
      heading: "Name the captain, then the five.",
      support: `A ${siteLabel} game. The CPT slot is 1.5×. Leave salary on the table and you lose to someone who spent it.`,
    };
  }
  if (isDfs) {
    return {
      eyebrow: "DFS",
      heading: "Pick the high totals.",
      support: `Mark the ${siteLabel} games you want stacked. Pin a stack if you want that quarterback. A loud ceiling does not lock a backup for you.`,
    };
  }
  return {
    eyebrow: "Lineups",
    heading: "Build this week's PPR lineup.",
    support: "Lock or skip names, then optimize. A wasted flex is points you left in the pool.",
  };
}

export function dfsHeroNote({ isDfs = true } = {}) {
  if (isDfs) {
    return {
      title: "Salaries from the slate.",
      body: "Projections stay ScoreSense. For entertainment and research only.",
    };
  }
  return {
    title: "Projections, not picks.",
    body: "For entertainment and research only. Not gambling or financial advice.",
  };
}

export function dfsStatusChip({
  isDfs = true,
  loadingSalaries = false,
  importStats = null,
  slateMeta = null,
  poolCount = 0,
} = {}) {
  if (loadingSalaries) return { label: "Loading slate", tone: "readonly" };
  if (slateMeta?.offseason_placeholder) return { label: "Offseason slate", tone: "readonly" };
  if (isDfs && importStats?.matched != null) {
    return { label: `${importStats.matched} salaries`, tone: "active" };
  }
  if (poolCount > 0) return { label: `${poolCount} players`, tone: "active" };
  return { label: isDfs ? "Pick a slate" : "Weekly pool", tone: "readonly" };
}

export function parseSalaryCap(salaryCap) {
  if (salaryCap == null || salaryCap === "") return null;
  const value = Number(salaryCap);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function salarySpend({ totalSalary, salaryCap, salaryRemaining } = {}) {
  const cap = parseSalaryCap(salaryCap);
  const spent = Number(totalSalary);
  const used = Number.isFinite(spent) ? spent : 0;
  if (cap == null) {
    return { pct: 0, used, remaining: null, over: false, cap: null };
  }
  const remaining = (
    salaryRemaining != null
    && salaryRemaining !== ""
    && Number.isFinite(Number(salaryRemaining))
  )
    ? Number(salaryRemaining)
    : cap - used;
  const pct = Math.min(100, Math.max(0, (used / cap) * 100));
  return { pct, used, remaining, over: remaining < 0, cap };
}

export function lockedSalaryTotal(pool = [], lockedIds = []) {
  const locked = new Set(Array.from(lockedIds || [], (id) => String(id)));
  return (pool || []).reduce((sum, row) => {
    if (!locked.has(String(row.player_id))) return sum;
    const salary = Number(row.salary);
    return sum + (Number.isFinite(salary) ? salary : 0);
  }, 0);
}

export function capMeterTone({ remaining, cap } = {}) {
  if (!Number.isFinite(remaining) || !Number.isFinite(cap) || cap <= 0) return "neutral";
  if (remaining < 0) return "over";
  if (remaining / cap <= 0.05) return "tight";
  return "healthy";
}

export function dfsSummaryItems({
  siteLabel,
  season,
  week,
  slateName,
  isDfs = true,
  salaryCap,
  lockedCount = 0,
  excludedCount = 0,
  objectiveId = "median",
  lineupCount = 1,
  constructionSummary = "",
  stackGameLabel = "",
} = {}) {
  const items = [
    { id: "format", label: "Format", value: siteLabel || "—" },
    {
      id: "week",
      label: "Week",
      value: season != null && week != null ? `${season} · Wk ${week}` : "—",
    },
  ];
  if (isDfs) {
    items.push({ id: "slate", label: "Slate", value: slateName || "—" });
    items.push({ id: "cap", label: "Salary cap", value: formatSalary(parseSalaryCap(salaryCap)) });
  }
  if (stackGameLabel) {
    items.push({
      id: "game",
      label: /games/i.test(stackGameLabel) ? "Games" : "Game",
      value: stackGameLabel,
    });
  }
  items.push({ id: "goal", label: "Goal", value: objectiveLabel(objectiveId, isDfs) });
  items.push({ id: "locks", label: "Locked / skipped", value: `${lockedCount} / ${excludedCount}` });
  if (Number(lineupCount) > 1) {
    items.push({ id: "lineups", label: "Lineups", value: String(lineupCount) });
  }
  if (constructionSummary) {
    items.push({ id: "rules", label: "Rules", value: constructionSummary });
  }
  return items;
}

export function constructionSummary({
  stackCount = 0,
  bringBack = false,
  maxPerTeam = 0,
  maxExposure = 0,
  randomness = 0,
  minSpendLeft = 0,
  isDfs = true,
  lineupCount = 1,
} = {}) {
  const bits = [];
  if (stackCount > 0) bits.push(`QB +${stackCount}`);
  if (stackCount > 0 && bringBack) bits.push("bring-back");
  if (maxPerTeam > 0) bits.push(`≤${maxPerTeam}/team`);
  if (Number(lineupCount) > 1 && maxExposure > 0 && maxExposure < 1) {
    bits.push(`≤${Math.round(maxExposure * 100)}% exposure`);
  }
  if (randomness > 0) {
    const match = RANDOMNESS_OPTIONS.find((opt) => opt.id === randomness);
    bits.push(`${(match?.label || `${Math.round(randomness * 100)}%`).toLowerCase()} randomness`);
  }
  if (isDfs && minSpendLeft > 0) bits.push(`≤$${minSpendLeft.toLocaleString()} unspent`);
  return bits.join(" · ");
}

export function formatSlateOption(slate = {}) {
  const name = slate.name || slate.slate_id || "Slate";
  const games = Number(slate.game_count);
  const players = Number(slate.player_count);
  const extras = [];
  if (Number.isFinite(games) && games > 0 && !String(name).includes("game")) {
    extras.push(`${games}g`);
  }
  if (Number.isFinite(players) && players > 0) extras.push(`${players} players`);
  return extras.length ? `${name} (${extras.join(" · ")})` : name;
}

export function slateLoadCopy({
  site,
  formats = DEFAULT_FORMATS,
  importStats = null,
  loadingSalaries = false,
  slateMeta = null,
  slateCount = null,
} = {}) {
  const cfg = formats[site] || DEFAULT_FORMATS[site] || DEFAULT_FORMATS.seasonal;
  const roster = rosterHint(site, formats);
  if (loadingSalaries) return `${cfg.label} — loading live salaries…`;
  const sparse = Number.isFinite(Number(slateCount)) && Number(slateCount) > 0 && Number(slateCount) <= 2;
  if (!importStats) {
    if (sparse) {
      return `${cfg.label} — ${roster}. DraftKings has posted ${slateCount} NFL slate${Number(slateCount) === 1 ? "" : "s"} so far; more weekend slates appear here as they go live.`;
    }
    return `${cfg.label} — ${roster}. Pick a slate or import a CSV.`;
  }
  const bits = [`${importStats.matched} matched`];
  if (importStats.dst_added) bits.push(`${importStats.dst_added} DST`);
  if (importStats.pool_without_salary) {
    bits.push(`${importStats.pool_without_salary} without salary`);
  }
  if (slateMeta?.offseason_placeholder) bits.push("offseason/test slate");
  if (sparse) bits.push(`${slateCount} slate${Number(slateCount) === 1 ? "" : "s"} posted`);
  return `${cfg.label} — ${roster}. Slate loaded: ${bits.join(" · ")}`;
}

export function emptyLineupCopy({ optimizing = false, isDfs = true, hasStack = false } = {}) {
  if (optimizing) return "Running optimizer…";
  if (hasStack) {
    return isDfs
      ? "Build takes a QB stack from the games you marked. Pin a stack if you want that side."
      : "Build takes a stack from the games you marked.";
  }
  if (isDfs) return "Lock or skip players, then build a lineup under the cap.";
  return "Lock or skip players, then build a lineup.";
}

export function optimizeButtonLabel({
  optimizing = false,
  lineupCount = 1,
  hasLineup = false,
  hasStack = false,
} = {}) {
  if (optimizing) return "Optimizing…";
  if (hasLineup) {
    return Number(lineupCount) > 1 ? `Rebuild ${lineupCount} lineups` : "Rebuild this lineup";
  }
  if (hasStack) {
    return Number(lineupCount) > 1
      ? `Build ${lineupCount} lineups around these games`
      : "Build around these games";
  }
  if (Number(lineupCount) > 1) return `Build ${lineupCount} lineups`;
  return "Build this lineup";
}

export const DFS_POOL_COPY = {
  lockSkip: "Lock / Skip",
  clearLocks: "Clear locks",
  inLineup: "In lineup",
  swap: "Swap",
};

export const POOL_COLUMN_TIPS = {
  pos: "Position",
  implied: "Implied team total from the Vegas board",
  salary: "Slate salary",
  proj: "Median projected points (P50)",
  value: "Projected points per $1,000 of salary",
  floor: "Low outcome (P10) — the Floor goal optimizes this",
  ceiling: "High outcome (P90) — the Ceiling goal optimizes this",
};

const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const DST_POSITIONS = new Set(["DST", "DEF"]);

export function pinActionLabel(kind, playerName) {
  const name = String(playerName || "player").trim() || "player";
  return kind === "skip" ? `Skip ${name}` : `Lock ${name}`;
}

export function swapActionLabel(incomingName, outgoingName) {
  const incoming = String(incomingName || "player").trim() || "player";
  const outgoing = String(outgoingName || "").trim();
  if (outgoing) return `Swap ${incoming} in for ${outgoing}`;
  return `Swap ${incoming} into the lineup`;
}

export function buildResultLiveText({
  ok = true,
  playerCount = 0,
  totalPoints = null,
  error = "",
} = {}) {
  if (!ok) return error || "Could not build a valid lineup.";
  const count = Number(playerCount) || 0;
  const people = `${count} player${count === 1 ? "" : "s"}`;
  if (totalPoints != null && Number.isFinite(Number(totalPoints))) {
    return `Lineup is built. ${people}, ${Number(totalPoints).toFixed(1)} total.`;
  }
  return `Lineup is built. ${people}.`;
}

export function swapResultLiveText({ incomingName, outgoingName } = {}) {
  return `Swapped ${outgoingName} for ${incomingName}.`;
}

export function objectiveSortColumn(objectiveId) {
  if (objectiveId === "floor") return "floor";
  if (objectiveId === "ceiling") return "ceiling";
  if (objectiveId === "value") return "value";
  return "proj";
}

export function poolSortValue(row = {}, column, vegasTeams = {}) {
  switch (column) {
    case "player":
      return String(row.Player || "").toLowerCase();
    case "pos":
      return String(row.Position || "");
    case "team":
      return String(row.Team || "");
    case "implied": {
      const num = Number(vegasTeams[row.Team]?.implied_total);
      return Number.isFinite(num) ? num : Number.NEGATIVE_INFINITY;
    }
    case "salary":
      return Number(row.salary) || 0;
    case "proj":
      return Number(row["Projected Points"]) || 0;
    case "value":
      return Number(row.value) || 0;
    case "floor":
      return Number(row["Low (P10)"]) || 0;
    case "ceiling":
      return Number(row["High (P90)"]) || 0;
    default:
      return 0;
  }
}

export function sortPoolRows(rows = [], { column = "proj", dir = "desc" } = {}, vegasTeams = {}) {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const av = poolSortValue(left, column, vegasTeams);
    const bv = poolSortValue(right, column, vegasTeams);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * mul;
    }
    return (av - bv) * mul;
  });
}

export function nextExclusiveChoice(ids = [], current, key) {
  const delta = key === "ArrowRight" || key === "ArrowDown"
    ? 1
    : key === "ArrowLeft" || key === "ArrowUp"
      ? -1
      : 0;
  if (!delta || !ids.length) return current;
  const idx = ids.indexOf(current);
  const from = idx < 0 ? 0 : idx;
  return ids[(from + delta + ids.length) % ids.length];
}

function normalizeSlot(value) {
  return String(value || "").trim().toUpperCase();
}

export function slotAcceptsPosition(slot, position) {
  const s = normalizeSlot(slot);
  const p = normalizeSlot(position);
  if (!s || !p) return false;
  if (s === p) return true;
  if (DST_POSITIONS.has(s) && DST_POSITIONS.has(p)) return true;
  if ((s === "FLEX" || s === "F") && FLEX_POSITIONS.has(p)) return true;
  if ((s === "CPT" || s === "MVP") && p && p !== "DST" && p !== "DEF") return true;
  return false;
}

export function pickSwapTarget(lineup = [], position) {
  const exact = lineup.filter((row) => normalizeSlot(row.slot) === normalizeSlot(position)
    || (DST_POSITIONS.has(normalizeSlot(row.slot)) && DST_POSITIONS.has(normalizeSlot(position))));
  const pool = exact.length
    ? exact
    : lineup.filter((row) => slotAcceptsPosition(row.slot, position));
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => (Number(a.proj) || 0) - (Number(b.proj) || 0))[0];
}

export function poolRowToLineupSlot(poolRow, slot) {
  return {
    slot,
    player: poolRow.Player,
    player_id: poolRow.player_id,
    team: poolRow.Team,
    position: poolRow.Position,
    proj: poolRow["Projected Points"],
    salary: poolRow.salary,
    floor: poolRow["Low (P10)"],
    ceiling: poolRow["High (P90)"],
  };
}

export function lineupTotals(lineup = []) {
  return lineup.reduce((acc, row) => {
    const proj = Number(row.proj);
    const salary = Number(row.salary);
    if (Number.isFinite(proj)) acc.totalPoints += proj;
    if (Number.isFinite(salary)) acc.totalSalary += salary;
    return acc;
  }, { totalPoints: 0, totalSalary: 0 });
}

export function swapPoolPlayerIntoLineup(lineup = [], poolRow) {
  if (!poolRow || !lineup.length) return null;
  const incomingId = String(poolRow.player_id || "");
  if (!incomingId) return null;
  if (lineup.some((row) => String(row.player_id) === incomingId)) return null;
  const outgoing = pickSwapTarget(lineup, poolRow.Position);
  if (!outgoing) return null;
  const next = lineup.map((row) => (
    String(row.player_id) === String(outgoing.player_id) && row.slot === outgoing.slot
      ? poolRowToLineupSlot(poolRow, outgoing.slot)
      : row
  ));
  return {
    lineup: next,
    outgoing,
    incoming: poolRow,
    ...lineupTotals(next),
  };
}

export function vegasKickoffLabel(kickoffEt, weekday) {
  if (!kickoffEt) return weekday ? String(weekday).slice(0, 3) : "TBD";
  const date = new Date(kickoffEt);
  if (Number.isNaN(date.getTime())) return weekday ? String(weekday).slice(0, 3) : "TBD";
  const day = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${day} ${time}`;
}

/** Number(null) is 0 — treat null/empty as a missing line instead. */
function lineNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function lineValue(value) {
  const num = lineNumber(value);
  if (num == null) return "—";
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function spreadLabelForValue(game, value) {
  const spread = lineNumber(value);
  if (spread == null) return "No line";
  if (spread === 0) return "Pick 'em";
  const favorite = spread > 0 ? game.home : game.away;
  return `${displayNflTeam(favorite)} -${lineValue(Math.abs(spread))}`;
}

export function vegasSpreadLabel(game = {}) {
  return spreadLabelForValue(game, game.spread_line);
}

export function vegasTotalLabel(game = {}) {
  const total = lineNumber(game.total_line);
  if (total == null) return "O/U —";
  return `O/U ${lineValue(total)}`;
}

export function vegasTotalValue(game = {}) {
  return lineValue(game.total_line);
}

/** Movement against the first line ScoreSense saw. Empty text when there is no baseline. */
export function vegasLineMovement(game = {}) {
  const currentTotal = lineNumber(game.total_line);
  const firstTotal = lineNumber(game.first_seen_total_line);
  const currentSpread = lineNumber(game.spread_line);
  const firstSpread = lineNumber(game.first_seen_spread_line);
  const hasTotalBaseline = currentTotal != null && firstTotal != null;
  const hasSpreadBaseline = currentSpread != null && firstSpread != null;
  const totalChanged = hasTotalBaseline && currentTotal !== firstTotal;
  const spreadChanged = hasSpreadBaseline && currentSpread !== firstSpread;
  let total = "";
  if (totalChanged) {
    total = DFS_STEP_COPY.totalMove(currentTotal > firstTotal ? "up" : "down", lineValue(firstTotal));
  } else if (hasTotalBaseline) {
    total = DFS_STEP_COPY.noMove;
  }
  let spread = "";
  if (spreadChanged) spread = DFS_STEP_COPY.spreadMove(spreadLabelForValue(game, firstSpread));
  else if (hasSpreadBaseline) spread = DFS_STEP_COPY.noMove;
  return {
    hasBaseline: hasTotalBaseline || hasSpreadBaseline,
    totalChanged,
    spreadChanged,
    total,
    spread,
  };
}

export function vegasImplied(value) {
  const num = lineNumber(value);
  return num != null ? num.toFixed(1) : "—";
}

/** One-line matchup context for a pool row: "vs NE · 24.0 implied". */
export function teamMatchupHint(teamCtx) {
  if (!teamCtx || !teamCtx.opponent) return "";
  const at = teamCtx.is_home ? "vs" : "@";
  const implied = lineNumber(teamCtx.implied_total);
  const impliedText = implied != null ? ` · ${implied.toFixed(1)} implied` : "";
  return `${at} ${teamCtx.opponent}${impliedText}`;
}

export function highestTotalGameId(games = []) {
  let best = null;
  let bestTotal = null;
  for (const game of games) {
    const total = lineNumber(game.total_line);
    if (total == null) continue;
    if (bestTotal == null || total > bestTotal) {
      best = game;
      bestTotal = total;
    }
  }
  return best ? best.game_id : null;
}

export function exposureListCopy({ lineupCount = 0 } = {}) {
  return {
    title: "Exposure",
    hint: `Share of your ${lineupCount} lineups each player appears in.`,
  };
}

export function launchCopy({
  isDfs = true,
  hasLineup = false,
  siteLabel = "DraftKings Classic",
  stackGameLabel = "",
} = {}) {
  if (hasLineup) {
    return {
      title: "Lineup is built.",
      body: isDfs
        ? "Salary and projection sit together. Swap a lock if the news moved."
        : "Projected points by slot. Swap a lock if your week changed.",
    };
  }
  if (stackGameLabel) {
    return {
      title: `${stackGameLabel}.`,
      body: isDfs
        ? "Build takes a stack from those totals and spends the leftover on other games."
        : "Build takes a stack from those games.",
    };
  }
  if (isDfs) {
    return {
      title: "Nine spots, one cap.",
      body: `A ${siteLabel} lineup. Go over the cap and it will not submit.`,
    };
  }
  return {
    title: "Your lineup.",
    body: "Best-effort PPR from this week's projections.",
  };
}

export function dfsRailTitle({ locked = 0, skipped = 0 } = {}) {
  return `Your lineup · ${locked} locked · ${skipped} skipped`;
}

/** Zero athlete changes still requires a distinct Captain scoring lineup. */
export function lineupDifferenceOptions(isCaptain) {
  const options = [1, 2, 3, 4].map(id => ({ id, label: String(id) }));
  return isCaptain ? [{ id: 0, label: "Captain change only" }, ...options] : options;
}

export function normalizeLineupDifferences(value, isCaptain) {
  const number = Number(value);
  return Math.min(4, Math.max(isCaptain ? 0 : 1, Number.isFinite(number) ? Math.trunc(number) : 2));
}


export const DFS_CAPTAIN_COMPARISON_COPY = {
  title: "Captain comparison",
  action: "Compare Captains",
  loading: "Comparing complete lineups…",
  help: "Compare complete lineups using your score and lineup rules. Positive exposure limits, lineup count, minimum differences and randomness do not apply. Zero Captain limits stay excluded from that role.",
  empty: "Load a single-game player pool to compare Captains.",
  ready: "Run a comparison to see how changing Captain changes the full lineup.",
  locked: "Your Captain lock limits this comparison to one player. Clear it to compare alternatives.",
  partial: "Comparison incomplete. The best evaluated lineup may not be the best available; some Captains could not be resolved within the comparison limits.",
  none: "No validated candidate is available from this comparison.",
  score: "Objective sum",
  gap: "Behind best evaluated",
  salary: "Salary used",
  semantics: "Scores are sums of player projection inputs, not expected payouts or lineup outcome probabilities.",
  failure: "Captain comparison failed. Try again.",
  mismatch: "The comparison does not match its build inputs. Run it again.",
  status: {
    optimal: "Solved",
    infeasible: "No feasible lineup under these constraints",
    unresolved: "Solve unfinished",
    invalid: "Failed lineup validation",
    not_evaluated: "Not evaluated within comparison limits",
  },
};

export function captainComparisonSummary(report) {
  const rows = Array.isArray(report?.candidates) ? report.candidates : [];
  const solved = rows.filter(row => row.status === "optimal" && Number.isFinite(row.objective_score) && row.result?.validation?.ok && row.result?.lineup?.length === 6);
  return {
    rows, solved,
    complete: report?.complete === true && rows.length > 0 && rows.length === report.eligible_captains && rows.every(row =>
      row.status === "infeasible" || solved.includes(row)),
    count: `${solved.length} ${solved.length === 1 ? "lineup" : "lineups"} solved · ${report?.evaluated_captains ?? 0} of ${report?.eligible_captains ?? 0} Captains evaluated`,
    objective: DFS_SHOWDOWN_COPY.objectives[report?.objective] || "Objective sum",
  };
}


/** UI partitions must not count unavailable players as ready or missing. */
export function dfsPlayerStatus(player) {
  const injury = String(player["Injury Status"] || "").toLowerCase();
  if (player.on_bye || (player.Position !== "DST" && ["out", "ir", "pup", "inactive", "suspended"].some(s => injury.includes(s)))) return "unavailable";
  return ["Low (P10)", "Projected Points", "High (P90)"].every(key => player[key] != null && player[key] !== "" && Number.isFinite(Number(player[key]))) ? "available" : "missing";
}

export function dfsPoolCoverage(players = []) {
  const groups = { available: [], unavailable: [], missing: [], sources: {} };
  for (const player of players) {
    const status = dfsPlayerStatus(player);
    groups[status].push(player);
    if (status === "available") {
      const source = Object.hasOwn(DFS_WORKSPACE_COPY.sourceDescriptions, player.projection_source) ? player.projection_source : "Other";
      groups.sources[source] = (groups.sources[source] || 0) + 1;
    }
  }
  return groups;
}

export function dfsEstimateSources(players = []) {
  const sources = new Map();
  players.filter(player => dfsPlayerStatus(player) === "available").forEach(player => {
    const source = String(player.projection_source || "").trim() || DFS_WORKSPACE_COPY.sourceDescriptions.Other;
    sources.set(source, (sources.get(source) || 0) + 1);
  });
  return [...sources].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

export function dfsPoolFreshness({ source, busy, checkedAt, refresh, failed, recovery, projectionStale, season, week, now = Date.now() }) {
  const c = DFS_WORKSPACE_COPY;
  if (source === "upload") return { tone: "neutral", label: c.uploadedPool, detail: c.uploadedPoolHelp };
  if (busy && !checkedAt) return { tone: "neutral", label: c.freshnessLoading, detail: "" };
  if (failed) return { tone: "warning", label: checkedAt ? c.freshnessFailed : c.freshnessLoadFailed, detail: checkedAt ? c.originalInputs : "" };
  if (!checkedAt) return { tone: "neutral", label: c.freshnessPending, detail: "" };
  if (['queued','running','busy'].includes(recovery?.status)) return { tone: "warning", label: "Updating projections", detail: "Any saved forecasts stay available while this slate updates." };
  if (projectionStale || recovery?.status === 'error') return { tone: "warning", label: c.freshnessStale, detail: "Using saved forecasts for this slate. The update will retry automatically." };
  const interval = Number(refresh?.refresh_interval_seconds) > 0 ? Number(refresh.refresh_interval_seconds) : 300;
  const timestamp = Date.parse(refresh?.last_success_at);
  const contextMismatch = (refresh?.season != null && Number(refresh.season) !== Number(season)) || (refresh?.week != null && Number(refresh.week) !== Number(week));
  const stale = refresh?.stale || refresh?.status === "error" || (Number.isFinite(timestamp) && now - timestamp > interval * 2000) || now - checkedAt > interval * 2000;
  const time = value => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (contextMismatch) return { tone: "neutral", label: c.freshnessHistorical, detail: c.checkedAt(time(checkedAt)) };
  if (stale) return { tone: "warning", label: c.freshnessStale, detail: c.checkedAt(time(checkedAt)) };
  if (!Number.isFinite(timestamp)) return { tone: "neutral", label: c.freshnessUnknown, detail: c.checkedAt(time(checkedAt)) };
  return { tone: "good", label: c.checkedAt(time(checkedAt)), detail: `${c.projectionsAt(time(timestamp))} · ${c.refreshCadence(Math.round(interval / 60))}` };
}
export const DFS_EVIDENCE_COPY = Object.freeze({
  title: "Lineup comparisons", open: "Review game & role evidence", refresh: "Refresh evidence",
  focusMissing: "A focused game has no eligible quarterback identity in this pool. Review the game scope before comparing.",
  invalidControls: "Review salary and team limits before selecting comparison inputs. Hard limits cannot be silently changed.",
  responseMismatch: "The comparison response belongs to different selected inputs. Your previous review is retained; retry using the current snapshot.",
  select: "Use current inputs", compare: "Compare lineups", download: "Download comparison review",
  intro: "Explore alternatives using a fixed set of player inputs.",
  loading: "Loading evidence…", missing: "No game evidence for this slate. You can still compare player inputs.",
  failed: "Evidence unavailable. Saved inputs remain available.",
  selected: "Selected inputs", newest: "Updated evidence is ready. Select it to use it.",
  selectedWithoutEvidence: "Using player inputs without game evidence.",
  stale: "Player inputs or controls changed. Select the current inputs before comparing again.",
  semantics: "Scores sum the selected player inputs. They are not lineup percentiles, win probabilities or expected payouts.",
  bounded: "Comparisons evaluate a bounded set of complete nine-player rosters. Best evaluated does not mean best across every possible lineup.",
  controls: "Locks, exclusions, salary limits, team limits, native stack rules and the QB/opposing-DST guard apply. Portfolio exposure, collection size, overlap and randomness do not apply to this read-only comparison. Weighted games define QB focus only; their shares do not weight comparison scores.",
  scope: "Primary focus limits the quarterback only. Complementary players can come from any eligible game. Excluded quarterbacks are reviewed as challengers and are not added to builds.",
  pace: "Unfitted volume screen: each team uses 75% season and 25% venue plays for/against, then averages its own offense with the opponent’s defense. Season contains venue games; the samples are not independent. Missing venue terms use season values. Dropbacks multiply this screen by the same-universe observed dropback rate; they are not calibrated projections.",
  observed: "Historical targets and carries use full-offense denominators from the same games and count definition. They are observations, not expected future roles. Targets do not establish routes.",
  specialist: "Routes, coverage, RB goal-line roles and DST event distributions require independent evidence. Missing specialist data remains unavailable.",
  games: "Games", players: "Player observations", comparisons: "Complete-lineup comparisons", sources: "Sources & definitions",
  unavailable: "Unavailable", retry: "Retry", contextRequired: "Choose an exact Classic slate or import a salary file before selecting comparison inputs.",
  poolRequired: "Comparisons need 9–750 players with whole salaries and complete finite player inputs.",
  exactIds: "Comparison inputs require distinct exact canonical player IDs.", lockMissing: "A locked player lacks complete comparison inputs. Resolve that player before selecting inputs.",
  contextMismatch: "Evidence belongs to another slate. Refresh this slate’s evidence before selecting inputs.",
  noSelection: "Select inputs to begin.",
  progress: "Comparing complete lineups…", snapshot: "One frozen input snapshot", score: "Input score sum",
  cancel: "Cancel comparison", elapsed: seconds => `${seconds}s elapsed`,
  cancelled: "Comparison cancelled. The previous review is retained. The server may finish its bounded work; late responses are discarded.",
  currentScores: "Existing collection on selected inputs", unchanged: "Original saved build forecasts remain unchanged. Missing player coverage makes a comparison unavailable.",
  return: "Return to matchups", allGames: "All eligible games", primaryGames: "Primary QB focus", challengerGames: "Excluded QB alternatives",
  search: "Find a player", position: "Position", previous: "Previous", next: "Next", noRows: "No matching observations.",
  retrospective: "Retrospective evidence",
  live: "Declared source times checked",
  timingHelp: "Retrospective observations have no established archived pre-lock availability. Live evidence checks declared times against the cutoff; source authenticity is not independently attested.",
  noEligibleGames: "No matching game evidence in this player pool.",
  gameHelp: "How game evidence works", roleHelp: "Definitions & missing data", comparisonHelp: "Scoring & comparison limits",
  sourceHelp: "Content hashes identify imported bytes, not permission or authenticity. Personal analysis, hosting, display, redistribution, training and external-model rights are separate.",
  emptyComparison: "No comparisons yet.", notEvaluated: "Not evaluated within the comparison budget", conflicting: "Infeasible under the selected rules",
  controlSummary: (rule, noun) => rule?.mode === "optional" ? `${noun} optional` : rule?.mode === "forbidden" ? `No ${noun.toLowerCase()}` :
    `${({ minimum: "At least", maximum: "At most", exact: "Exactly" })[rule?.mode] || "Unknown"} ${rule?.count ?? "—"} ${noun.toLowerCase()}`,
  labels: { gameScope: "Game scope", allPositions: "All positions", plays: "Plays", combined: "Combined", attachments: "Attachments", bringBack: "Opposing players",
    frozenAt: "Frozen at", evidenceVersion: "Evidence version", objective: "Objective", inputCount: "Eligible complete inputs", combinedPlays: "Combined play screen",
    playScreen: "Play screen", dropbackScreen: "Rough dropback screen", dropbackRate: "Observed dropback rate", sample: "Season games / venue games",
    seasonCounts: "Season plays for / against", venueCounts: "Venue plays for / against", seasonAlternative: "Season-only alternative", venueAlternative: "Venue-only alternative", pooledAlternative: "Declared pooled alternative",
    observedGames: "Observed games", targets: "Targets / full-offense targets", targetShare: "Target share", carries: "Carries / full-offense carries", carryShare: "Carry share",
    routes: "Routes", teamRouteRate: "Routes / team dropbacks", playerPassSnaps: "Player passing snaps", teamDropbacks: "Team dropbacks", playerRouteRate: "Routes / player passing snaps", receivingGrade: "Receiving grade",
    sourceUri: "Source URI", hash: "Raw content SHA-256", period: "Observed period", definition: "Definition / units", filters: "Raw filters", publication: "Publication", retrieved: "Retrieved", knownAt: "Known at", revision: "Revision",
    allowed: "Allowed", denied: "Not allowed", unknown: "Unknown", bestPrimary: "Best evaluated primary alternative", bestChallenger: "Strongest evaluated excluded alternative",
    actualAttachments: "Actual same-team attachments", actualBringBack: "Actual opposing players", receivingEligibility: "Declared receiving RB IDs", noReceivingRbs: "None declared" },
});

export const DFS_SHARED_OUTCOMES_COPY = Object.freeze({
  title: "Shared-game scenarios", intro: "Compare your lineups on the same supplied game outcomes.",
  research: "Research only. Scenario percentiles are empirical scores, not calibrated forecasts or payouts.",
  file: "Scenario JSON", fileHelp: "Import a permitted event bank for this exact slate (up to 8 MB).", fileSelected: name => `File: ${name}`, previewDetails: "Preview details",
  scope: "Lineups to review", build: "Current build", collection: "Collection", settings: "Review settings", seed: "Random seed", draws: "Scenario draws",
  preview: "Preview scenarios", use: "Use this scenario bank", evaluate: "Review lineups", download: "Download scenario review", cancel: "Cancel",
  ready: "Ready to preview", fileReady: "File checked locally. Preview it to review the scenario bank.", previewReady: "Preview ready. Select this bank to use it.",
  selected: "Scenario bank selected.", complete: "Scenario review complete.",
  idle: "Import a scenario bank to begin.", reading: "Checking file…", previewing: "Previewing scenarios…", selecting: "Selecting inputs…", evaluating: "Reviewing lineups…", downloading: "Preparing download…",
  elapsed: seconds => `${seconds}s elapsed`, counts: counts => `${counts.games} games · ${counts.profiles} profiles · ${counts.pool_players} players`,
  selectedSummary: (name, count) => `${name} · ${count} ${count === 1 ? "lineup" : "lineups"} selected`,
  stale: "Inputs changed. Preview and select the current inputs before reviewing again.",
  previous: "Previous review — kept for reference.", previewStale: "Preview belongs to earlier inputs. Preview again before selecting.",
  results: "Scenario results", lineupLabel: n => `Lineup ${n}`, roster: "Selected roster", playerResults: "Player scores", search: "Find a player",
  mean: "Mean", p10: "Low scenario score (P10)", p50: "Middle scenario score (P50)", p90: "High scenario score (P90)", delta: "Mean change vs first lineup", zero: "Zero-score draws", negative: "Negative-score draws", min: "Minimum", max: "Maximum",
  previousPage: "Previous", nextPage: "Next", noRows: "No matching players.",
  audit: "Method, sources & checks", selectedInputs: "Selected inputs", snapshot: "Input snapshot", bank: "Scenario bank", frozen: "Selected at", gameDraws: "Game draws", lineupCount: "Lineups reviewed", poolCount: "Players covered", conservation: "Provided event ledgers conserved", passed: "Passed", runtime: "Server runtime", scoring: "Scoring version", source: "Source", hash: "Content SHA-256", rights: "Declared rights", allowed: "Allowed", denied: "Not allowed", unknown: "Unknown", decision: "Evidence cutoff", scopeLabel: "Evidence scope", period: "Observed period", published: "Published at", known: "Known at", retrieved: "Retrieved at", definition: "Definition", units: "Units",
  method: "Each draw samples one whole-game profile and scores every participant from its events. Games are sampled independently; lineups share the same draws. P10, P50 and P90 are the 10th, 50th and 90th percentile scores within the supplied draws. They do not describe future probabilities. Separate generation, selection and evaluation random streams do not establish independent finalist selection or calibrated joint tails.",
  limitations: "Source completeness, source authenticity, pre-lock availability, calibrated forecasts, calibrated joint tails and untouched finalist evaluation are not verified. Content hashes identify inputs; they do not prove authenticity or permission. This review changes no forecasts, saved builds or entries.",
  exportHelp: "The download contains this review and source receipts. Raw event banks and source observations are omitted.",
  sizeError: "Choose a scenario file smaller than 8 MB. The complete request must also fit this limit.", jsonError: "The file is not valid finite JSON.", structureError: "The scenario file is too deeply nested or contains too many values.", duplicateError: "Scenario JSON contains a duplicate or unsafe field.",
  schemaError: "Use a supported declared scenario-bank file.", contextError: "The scenario bank belongs to another slate.", rightsError: "Each source must explicitly allow personal analysis, hosted ingestion and display before previewing.", gameError: "Exact game IDs, teams and kickoff times must match this slate’s salary pool.", coverageError: "The scenario bank must cover every game in the selected player pool.",
  rosterError: "Each lineup needs nine distinct eligible players, legal Classic positions, at least two games and a salary of $50,000 or less.", duplicateLineups: "Remove duplicate lineups before reviewing this selection.", slateError: "Choose an exact DraftKings Classic slate before importing scenarios.", scopeError: "Choose the current build or collection.", identityError: "The player pool needs distinct exact player IDs.", poolError: "Scenario review needs 9–750 players with valid positions and whole salaries.", collectionContextError: "Selected lineups must belong to the current exact slate.", lineupLimit: "Review up to 150 lineups at a time.",
  responseError: "The response does not match the selected scenario inputs. Your previous review is retained.", buildFirst: "Build or collect a complete lineup before reviewing it.", settingsError: "Use a whole seed from 0 to 2,147,483,647 and a supported draw count.", workerError: "The background file processor is unavailable. Try reloading this page.", cancelled: "Cancelled. Your previous review is retained; late responses are discarded.", failed: "Scenario review failed. Your previous review is retained.",
});
export const DFS_CONTEST_COPY = Object.freeze({
  title: "Contest scenarios", intro: "See how different opponent assumptions affect these lineups.",
  selectGames: "Select a current game-scenario file and complete lineups above first.",
  file: "Contest assumptions file", preview: "Preview contest", use: "Use these assumptions", compare: "Compare scenarios",
  download: "Save contest review", cancel: "Cancel", reading: "Reading file…", previewing: "Checking contest…",
  evaluating: "Comparing scenarios…", downloading: "Preparing review…", ready: "Assumptions selected.", idle: "Optional research · no changes to your lineups.",
  failed: "The comparison could not finish. Your last review is still available.",
  fileError: "Use a contest file for these exact games, lineups and decision time, with a complete cash payout schedule.",
  rightsError: "The file needs permission for personal analysis, hosted processing and display before upload.",
  sizeError: "The complete research package must fit within 8 MB.", responseError: "The response does not match this review. Select the inputs again.",
  workerError: "File processing is unavailable. Try reopening this page.", cancelled: "Comparison cancelled.",
  settingsError: "Choose 32–256 draws and a top-finish cutoff within the contest size.",
  stale: "Inputs changed. Preview and select the assumptions again.", previous: "Showing an earlier review. Its saved inputs are unchanged.",
  contest: "Contest", entries: "Total entries", fee: "Fee per entry", results: "Under these assumptions",
  assumptionLimit: "These are scenario results, not forecast returns. Dollar displays are rounded; saved results retain exact fractions.",
  averageNet: "Average net", lowNet: "Low scenario net", highNet: "High scenario net",
  topFinish: n => `Any top-${n} finish`, moreResults: "Payout and finish details", averagePayout: "Average payout", fees: "Fees for this set",
  firstTie: "Tied for first", soleFirst: "First without a tie", cash: "Any paid finish",
  sampleHelp: "Low and high mark the 10th and 90th percentiles of these samples. Finish percentages count samples only. Ties include all entries; fees are deducted once.",
  settings: "Comparison settings", draws: "Draws", topK: "Top finish cutoff", settingsHelp: "Uses the seed selected above. More draws reduce sampling noise, not uncertainty in the assumptions.",
  details: "Method and sources", method: "Whole legal opponent lineups preserve stacks and repeated entries. Each assumption uses the same game outcomes and the full declared contest size. Unsupported noncash prizes are unavailable.",
  rights: "Files require declared processing rights. Personal downloads omit raw opponent templates and ownership observations; source declarations do not certify platform settlement.",
  version: "Selected version", rounding: "Declared rounding rule",
  ownershipScope: "Ownership audience", templateCount: "Distinct opponent lineups", knownOwnership: "Players with supplied ownership",
  ownershipGap: "Average gap from lineup mix", source: "Source", sourceHash: "Source hash", sourceKnown: "Known at",
  audience: value => ({ mini_max: "Mini-MAX", milly: "Millionaire", single_entry: "Single entry", three_max: "Three entry maximum", other_gpp: "Other tournament", broad_public: "Broad public board" }[value] || value),
  roundingLabel: value => ({ exact_fraction: "Exact share before settlement", floor_cent: "Round down to the cent", half_up_cent: "Nearest cent, half up" }[value] || value),
});
export const DFS_CONTEST_PORTFOLIO_COPY = Object.freeze({
  title: "Choose a lineup set", intro: "Compare a proposed set with a projection-first set under one opponent assumption.",
  unavailable: "Select current game and contest assumptions above first.", candidates: n => `Choose from ${n} complete lineups.`,
  assumption: "Opponent assumption", chooseAssumption: "Choose an assumption", count: "Lineups to choose", goal: "Choose for", select: "Compare lineup sets", cancel: "Cancel", download: "Save proposed set",
  goals: [{ id: "conditional_mean_net", label: "Average scenario net" }, { id: "conditional_risk_adjusted_net", label: "Balance net and downside" }, { id: "conditional_top_finish", label: "Cover top finishes" }],
  goalHelp: {
    conditional_mean_net: "Favor higher average payouts after entry fees in the supplied scenarios.",
    conditional_risk_adjusted_net: "Balance average net against losses in the worst supplied scenarios.",
    conditional_top_finish: "Favor sets with at least one lineup reaching the selected top-finish cutoff.",
  },
  risk: "Downside settings", worst: "Worst samples to weigh", weight: "Downside weight", riskHelp: "Loss is entry fees minus cash payouts. A weight of 1 subtracts the average loss in those worst samples once from average net. A negative loss means a gain.",
  tails: [{ id: "0.9", label: "Worst 10%" }, { id: "0.8", label: "Worst 20%" }, { id: "0.75", label: "Worst 25%" }, { id: "0.5", label: "Worst 50%" }],
  inheritance: (draws, top) => `Uses ${draws} draws and top ${top} from the comparison settings above. Your frozen locks, skips and active limits apply.`,
  idle: "Optional proposal · your build and collection stay unchanged.", running: "Comparing sets…", downloading: "Preparing proposed set…", elapsed: n => `${n}s elapsed`,
  failed: "The set comparison could not finish. Your previous proposal is still available.", cancelled: "Comparison cancelled. Your previous proposal is retained.",
  settingsError: "Choose a whole lineup count within your candidate set, one supplied assumption, and a downside weight from 0 to 100.",
  inputsError: "The selected snapshot needs complete, finite player scores for its original scoring goal.",
  legacyStackError: "This snapshot uses legacy stack controls. Rebuild with the exact Classic stack controls before comparing sets.",
  collectionError: "Collection appearance controls conflict with this set size. Adjust them and select a new snapshot before comparing.",
  responseError: "The proposed set does not match these frozen inputs. Your previous proposal is retained.",
  workerError: "Background processing is unavailable. Try reopening this page.",
  stale: "Inputs changed. Select current game and contest assumptions before comparing again.", previous: "Earlier proposal — kept with its original inputs.",
  result: "Proposed set", conditional: "Scenario comparison only. Results on separate review draws can be worse than the baseline; they are not forecast returns.",
  baseline: "Projection-first set", proposed: "Proposed set", metric: "Measure", average: "Average net", low: "Low scenario net", top: n => `Any top-${n} finish`,
  downside: "Worst-sample average loss", adjusted: "Net less weighted downside", difference: "Change in average net", projection: "Original score sum",
  projectionHelp: "The baseline favors the original score sum under the same hard limits. Search details show whether its best score was proved. Scores retain the scoring goal frozen with these candidates.",
  comparisonDetails: "Search and comparison details", controls: "Applied settings", rosters: "Chosen lineups", roster: "Full roster", player: "Player", salary: "Salary", position: "Position", lineup: n => `Lineup ${n}`,
  previousPage: "Previous", nextPage: "Next", search: "Search result", optimal: "Best in this candidate pool", limited: "Best set found in limited search", timeLimited: "Time limit reached; complete set found", noSet: "No complete set found", conflicts: "Conflicts to resolve", unknown: "Unavailable", candidateOnly: "Search covers these complete candidates, not every legal lineup. Selection and review use separate random draws; supplied scenarios remain uncalibrated.",
  candidateCount: "Candidate lineups", requestedCount: "Requested lineups", chosenCount: "Unique lineups chosen", trials: "Sets tried", feasibleTrials: "Feasible sets reviewed", runtime: "Server time", bound: "Goal bound after target preference", gap: "Optimality gap", baselineSearch: "Projection-first search", baselineProved: "Best original score proved", baselineUnproven: "Complete set; best original score not proved",
  sensitivity: "Other opponent assumptions", sensitivityHelp: "Final review draws compare both sets against every supplied assumption. Only the selected assumption guides the search.",
  targetHelp: "Appearance targets are preferences. Among sets examined, prefer the smallest total target miss, then the chosen goal. Minimums and maximums remain firm.",
  lowHelp: "Low scenario net is the value at the 10% point of ordered review samples.", targetProof: "Appearance target search", targetProved: "Smallest target miss proved", targetUnproven: "Smallest target miss not proved", noTargets: "No appearance targets",
  target: "Appearance target misses", targetMiss: row => `${row.id}: ${row.actual_count} appearances; target ${row.target_count}.`,
  frozen: "Frozen input version", request: "Set comparison version", selectionDraws: "Selection draws", reviewDraws: "Separate review draws", source: "Opponent assumption", fees: "Fees for this set", exportHelp: "Personal review includes the chosen rosters and frozen inputs. Raw opponent lineups, ownership observations and game events are omitted.",
  archiveScope: "Personal analysis only. Computed proposal and source receipts; raw game events, opponent templates and ownership observations omitted. No entry submission or platform acceptance is recorded.",
});

export const DFS_LATE_SWAP_COPY = Object.freeze({
  title: "Plan late swaps", intro: "Compare remaining players while keeping started players in their exact slots.",
  scope: "Snapshot comparison only · no entry updates", file: "Late-swap snapshot JSON", fileHelp: "Snapshot format", fileFormat: "Use a supplied accepted-entry and lock snapshot for this exact slate (up to 8 MB).",
  preview: "Preview snapshot", use: "Use this snapshot", compare: "Compare remaining players", download: "Save late-swap plan", cancel: "Cancel",
  idle: "Import a snapshot to begin.", reading: "Checking snapshot…", previewing: "Checking entries and locks…", planning: "Comparing remaining players…", downloading: "Preparing plan…",
  ready: "Snapshot selected.", elapsed: n => `${n}s elapsed`, failed: "The comparison could not finish. Your previous plan is still available.",
  cancelled: "Comparison cancelled. Your previous plan is retained.", previous: "Earlier plan — kept with its original snapshot.", stale: "The slate changed. Preview and select a matching snapshot before comparing again.",
  unavailable: "Choose an exact DraftKings Classic slate before importing a snapshot.", sizeError: "Choose a snapshot smaller than 8 MB.", fileError: "Use a complete late-swap package with accepted entries, exact roster slots and known lock states.",
  contextError: "This snapshot belongs to another slate.", rightsError: "Each source needs permission for personal analysis, hosted processing and display.",
  lockError: "Every player needs a known game time and started status in this snapshot.",
  responseError: "The response does not match this snapshot. Your previous plan is retained.", workerError: "Background file processing is unavailable. Try reopening this page.", accessError: "Sign in to this account again before downloading the plan.",
  previewTitle: "Snapshot to review", contest: "Contest", entries: "Accepted entries", decision: "Comparison time", locked: "Started slots", candidates: "Supplied alternatives",
  result: "Late-swap plan", changed: n => `${n} ${n === 1 ? "entry changes" : "entries change"}`, unchanged: n => `${n} ${n === 1 ? "entry stays" : "entries stay"} the same`,
  rosters: "Review exact slots", entry: id => `Entry ${id}`, accepted: "Accepted snapshot", proposed: "Proposed", same: "Unchanged", lockedLabel: "Started", changedLabel: "Changed",
  before: "Before", after: "After", inputSum: "Unstarted-player input sum", inputHelp: "Sums the supplied inputs for players whose games have not started. Started players’ scores are excluded; this is not a remaining-points forecast.",
  salary: "Salary", previousPage: "Previous", nextPage: "Next", details: "Sources and planning details", version: "Snapshot version", planVersion: "Plan version", source: "Source", hash: "Content hash", known: "Known at",
  method: "Supplied accepted entries, contest rules and lock records are declarations. Their authenticity and current platform state are not verified.",
  exportGate: "Platform-ready late-swap CSV is unavailable. This personal plan does not change or submit entries.",
  search: "Search result", optimal: "Best supplied alternatives found", limited: "Complete plan; best score not proved", timeLimited: "Time limit reached; complete plan found", noSet: "No complete plan found", conflicts: "Conflicts to resolve", runtime: "Server time", tried: "Sets reviewed", unknown: "Unavailable",
  inputCount: "Supplied alternatives", bound: "Score bound", gap: "Optimality gap", targets: "Appearance preferences", targetMiss: (name, actual, target) => `${name}: ${actual} appearances; target ${target}.`, rejected: "Alternatives blocked by your rules",
  issue: code => ({ missing_global_lock: "Missing a required player", global_exclusion: "Includes a skipped player", strategy_salary_range: "Outside your salary limits", strategy_team_limit: "Exceeds your team limit", unstarted_status_not_declared_eligible: "Player status needs confirmation", qb_opposing_dst: "Quarterback faces selected defense", locked_exact_slot: "Started slot changed", incoming_started_player: "Adds a started player", hard_overlap: "Exceeds shared-player limit" }[code] || (code.startsWith("classic_stack:") ? "Stack rule unmet" : "Rule conflict")),
  downloadScope: "Personal snapshot comparison. Includes declared accepted entries and exact-slot proposal; no platform acceptance or submission is recorded.",
  sourceKinds: { user_platform_readback: "Accepted-entry readback", rules: "Contest rules", salary_catalog: "Salary catalog", lock_snapshot: "Started-game snapshot", projection_inputs: "Player inputs" },
});
