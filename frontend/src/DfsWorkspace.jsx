import DfsCaptainComparison from "./DfsCaptainComparison.jsx";
import DfsEvidenceReview from "./DfsEvidenceReview.jsx";
import DfsSharedOutcomesReview from "./DfsSharedOutcomesReview.jsx";
import { DFS_FLOW_COPY as F } from "./dfsToolPresentation.js";
import { DFS_EVIDENCE_COPY as EC } from "./dfsToolPresentation.js";
import DfsPortfolio from "./DfsPortfolio.jsx";
import DfsGlobalExposure from "./DfsGlobalExposure.jsx";
import DfsClassicStack from "./DfsClassicStack.jsx";
import DfsBuildPlans from "./DfsBuildPlans.jsx";
import DfsLocalDraft from "./DfsLocalDraft.jsx";
import { DfsBuildStatus, DfsCapabilityReview, DfsInputUpdate, DfsJourney } from "./DfsWorkflow.jsx";
import { workspaceCapabilities, countUniqueLineups } from "./dfsWorkspaceState.js";
import { DFS_WORKFLOW_COPY as WC } from "./dfsToolPresentation.js";
import { createEntryExportSession } from "./dfsEntryExportSession.js";
import { sealEntryExportArtifact } from "./dfsEntryExportSeal.js";
import { validateGlobalBuildForExport } from "./dfsGlobalExportValidation.js";
import { validatePrelockExport } from "./dfsPrelockExport.js";
import { DFS_GLOBAL_COPY as GC, DFS_GUARDRAIL_COPY as RC } from "./dfsToolPresentation.js";
import { auditPortfolio, buildPortfolioEntryCsv, createPortfolioBatch, portfolioLineups, portfolioEntryRecords } from "./dfsPortfolio.js";
import { downloadPortfolioBackupAsync, readPortfolioBackupFileAsync } from "./dfsPortfolioBackupAsync.js";
import { confirmDialog } from "./ui/confirm.jsx";
import { DFS_PORTFOLIO_COPY as PC } from "./dfsToolPresentation.js";
import DfsPoolCoverage, { DfsPoolFreshness, DfsSourceSummary } from "./DfsPoolCoverage.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout";
import {
  allocateMatchupWeights,
  dfsPoolCoverage,
  dfsPlayerStatus,
  lineupDifferenceOptions,
  MAX_LINEUP_COUNT,
  parseLineupCount,
  DFS_STEP_COPY,
  DFS_WORKSPACE_COPY as C,
  filterObjectives,
  formatSalary,
  gameStackLabel,
  highestTotalGameId,
  matchupWeightLabel,
  slateGames,
  vegasImplied,
  vegasKickoffLabel,
  vegasLineMovement,
  vegasSpreadLabel,
  vegasTotalValue,
} from "./dfsToolPresentation";
import { nflTeamColors } from "./DraftHub/nflTeamColors";
import { buildSiteLineupCsv, buildLineupDetailCsv } from "./dfsExport";
import { readEntryTemplate, buildEntryCsv } from "./dfsEntryExport";
import { moneyCents } from "./dfsCsv";
import { downloadCsv } from "./table";
import { jsonRequest } from "./useDfsBuilder";

const num = (n) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(1);
const options = (values) => values.map((v) => ({ id: v, label: String(v) }));
// Download the exact sealed bytes; generic table downloads normalize newlines.
function downloadEntryArtifact(artifact) {
  const url = URL.createObjectURL(new Blob([artifact.csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `${artifact.filename}-${Date.now()}.csv`;
  link.click(); URL.revokeObjectURL(url);
}
/** Surname only, so a row of six names still fits. Team defenses keep their name. */
export function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "";
  const tail = parts[parts.length - 1].replace(/[.,]/g, "");
  if (["Jr", "Sr", "II", "III", "IV", "V"].includes(tail)) return parts.slice(-2).join(" ");
  // "St. Brown", "Van Jefferson" — the particle belongs to the surname.
  const prior = parts[parts.length - 2] || "";
  const particle = prior.endsWith(".") || ["Van", "Von", "De", "Del", "La", "St"].includes(prior);
  return particle ? parts.slice(-2).join(" ") : parts[parts.length - 1];
}

/** The captain, named by slot so it reads as a role rather than a stray name. */
function lineupHeadline(entry) {
  const lead = (entry.lineup || []).find((p) => ["CPT", "MVP", "QB"].includes(p.slot));
  if (!lead) return "";
  return `${lead.slot} ${lead.player}`;
}

/** Everyone else, which is the only thing that distinguishes one lineup from another. */
function lineupSupporting(entry) {
  const lead = (entry.lineup || []).find((p) => ["CPT", "MVP", "QB"].includes(p.slot));
  return (entry.lineup || [])
    .filter((p) => p !== lead)
    .map((p) => shortName(p.player))
    .join(" · ");
}

export function DfsFile({ label, onFile, disabled = false, accept = ".csv,text/csv" }) {
  return (
    <label className={`dfw-file-button${disabled ? " is-disabled" : ""}`}>
      {label}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}
export function DfsField({ label, children }) {
  return (
    <div className="dfw-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function DfsMatchupBoard({ b, onEvidence, evidenceButtonRef }) {
  const games = useMemo(
    () => slateGames(b.vegasGames, b.pool),
    [b.vegasGames, b.pool],
  );
  const highestId = highestTotalGameId(games);
  const showsLineMoves = games.some((game) => vegasLineMovement(game).hasBaseline);
  const allocation = allocateMatchupWeights(b.stackWeights, b.settings.count);
  if (b.isCaptain) return null;
  return (
    <section className="dfw-panel dfw-matchups" aria-labelledby="dfw-matchups-title">
      <div className="dfw-matchups-head">
        <div>
          <h2 id="dfw-matchups-title">{F.games}</h2>
          <small>{F.optional}</small>
        </div>
        {!!allocation.length && (
          <button type="button" onClick={b.clearStackWeights}>
            {DFS_STEP_COPY.clearGames}
          </button>
        )}
      </div>
      {!games.length ? (
        <p className="dfw-note">{DFS_STEP_COPY.shootoutEmpty}</p>
      ) : (
        <>
          <div className="dfw-game-list">
            {games.map((game) => {
              const weight = Number(b.stackWeights[game.game_id]) || 0;
              const movement = vegasLineMovement(game);
              const awayColors = nflTeamColors(game.away);
              const homeColors = nflTeamColors(game.home);
              return (
                <article
                  key={game.game_id}
                  className={`dfw-game-row${weight ? " is-active" : ""}`}
                  style={{
                    "--dfw-away-top": awayColors.jersey[0],
                    "--dfw-away-bottom": awayColors.jersey[1],
                    "--dfw-away-mark": awayColors.plate,
                    "--dfw-home-top": homeColors.jersey[0],
                    "--dfw-home-bottom": homeColors.jersey[1],
                    "--dfw-home-mark": homeColors.plate,
                  }}
                >
                  <div className="dfw-game-summary">
                    <div><strong>{game.away} at {game.home}</strong><small>{vegasKickoffLabel(game.kickoff_et, game.weekday)} · {vegasTotalValue(game)} {F.total.toLowerCase()}</small></div>
                    <div className="dfw-game-weight" role="group" aria-label={`${DFS_STEP_COPY.stackWeight}: ${gameStackLabel(game)}`}>
                      <button type="button" aria-label={`${DFS_STEP_COPY.lowerWeight}: ${gameStackLabel(game)}`} disabled={!weight || b.building} onClick={() => b.changeStackWeight(game.game_id, -1)}>−</button>
                      <strong aria-live="polite">{matchupWeightLabel(weight)}</strong>
                      <button type="button" aria-label={`${DFS_STEP_COPY.raiseWeight}: ${gameStackLabel(game)}`} disabled={weight >= 4 || b.building} onClick={() => b.changeStackWeight(game.game_id, 1)}>+</button>
                    </div>
                  </div>
                  <details className="dfw-game-lines"><summary>{F.marketDetails}</summary>
                  {game.game_id === highestId && <small>{DFS_STEP_COPY.highestTotal}</small>}
                  <div className="dfw-matchup-stage">
                    <div className="dfw-matchup-team dfw-matchup-team--away">
                      <b>{game.away}</b>
                      <span title={DFS_STEP_COPY.impliedTitle}>{vegasImplied(game.away_implied)} <small>{DFS_STEP_COPY.impliedTitle}</small></span>
                    </div>
                    <span className="dfw-matchup-at">at</span>
                    <div className="dfw-matchup-team dfw-matchup-team--home">
                      <b>{game.home}</b>
                      <span title={DFS_STEP_COPY.impliedTitle}>{vegasImplied(game.home_implied)} <small>{DFS_STEP_COPY.impliedTitle}</small></span>
                    </div>
                  </div>
                  <div className="dfw-matchup-markets" role="group" aria-label={DFS_STEP_COPY.currentLine}>
                    <div>
                      <span>{F.total}</span>
                      <strong>{vegasTotalValue(game)}</strong>
                      <small className={movement.totalChanged ? "has-moved" : ""}>{movement.total}</small>
                    </div>
                    <div>
                      <span>{F.spread}</span>
                      <strong>{vegasSpreadLabel(game)}</strong>
                      <small className={movement.spreadChanged ? "has-moved" : ""}>{movement.spread}</small>
                    </div>
                  </div>
                  </details>
                </article>
              );
            })}
          </div>
          <details className="dfw-flow-disclosure">
            <summary>{F.gameHelp}</summary>
            <div className="dfw-detail-body">
              <p className="dfw-note">{F.gameHint}</p>
              <p className="dfw-note">{DFS_STEP_COPY.weightOnNote}</p>
              {!!allocation.length && <div className="dfw-matchup-plan">
                <h3>{DFS_STEP_COPY.lineupPlan}</h3>
                {allocation.map(entry => { const game = games.find(item => item.game_id === entry.gameId); return game ? <div className="dfw-matchup-plan-row" key={entry.gameId}><span>{gameStackLabel(game)}</span><strong>{DFS_STEP_COPY.lineupAllocation(entry.count)}</strong></div> : null; })}
              </div>}
              <p className="dfw-note">{DFS_STEP_COPY.impliedNote}</p>
              {showsLineMoves && <p className="dfw-note">{DFS_STEP_COPY.lineMoveNote}</p>}
              {b.context.site === "draftkings" && <button ref={evidenceButtonRef} type="button" onClick={onEvidence}>{EC.open}</button>}
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export default function DfsWorkspace({ b }) {
  const evidenceRef = useRef(null), evidenceButtonRef = useRef(null);
  const advancedRef = useRef(null), researchRef = useRef(null), buildPanelRef = useRef(null);
  const validLineupCount = parseLineupCount(b.settings.count) !== null;
  const [tab, setTab] = useState("pool"),
    [query, setQuery] = useState(""),
    [pos, setPos] = useState("ALL"),
    [availability, setAvailability] = useState("available"),
    [page, setPage] = useState(0);
  const [sort, setSort] = useState({
    key: "Projected Points",
    descending: true,
  });
  const slateRef = useRef(null),
    poolScrollRef = useRef(null),
    lineupsRef = useRef(null);
  const selectedLineupRef = useRef(null);
  const portfolioRef = useRef(null), entriesRef = useRef(null), buildButtonRef = useRef(null);
  const [journeyStage, setJourneyStage] = useState(0);
  const [template, setTemplate] = useState(null),
    [assignments, setAssignments] = useState({}),
    [sameSlate, setSameSlate] = useState(false);
  const [usePortfolio, setUsePortfolio] = useState(false);
  const [selectedContest, setSelectedContest] = useState("");
  const [entryPage, setEntryPage] = useState(0);
  const [exposurePage, setExposurePage] = useState(0);
  const [lineupPage, setLineupPage] = useState(0);
  const [exportState, setExportState] = useState(null);
  const exportSession = useRef(null);
  const exportReview = useRef(0);
  const templateImportSerial = useRef(0);
  const [exportingEntries, setExportingEntries] = useState(false);
  const [restoringPortfolio, setRestoringPortfolio] = useState(false);
  const [backupWorking, setBackupWorking] = useState(false);
  const backupFocus = useRef(null);
  const entryBusy = exportingEntries || restoringPortfolio || backupWorking || b.building;
  useEffect(() => {
    if (backupWorking) return;
    const saved = backupFocus.current;
    backupFocus.current = null;
    if (saved && saved.review === exportReview.current && saved.button.isConnected && !saved.button.disabled &&
        [document.body, saved.button].includes(document.activeElement)) saved.button.focus({ preventScroll: true });
  }, [backupWorking]);
  useEffect(() => {
    const invalidate = () => { exportReview.current++; exportSession.current = null; setExportState(null); };
    window.addEventListener("scoresense-auth-changed", invalidate);
    return () => { window.removeEventListener("scoresense-auth-changed", invalidate); exportReview.current++; exportSession.current = null; };
  }, []);
  const portfolioRows = useMemo(() => portfolioLineups(b.portfolio), [b.portfolio]);
  const portfolioEntries = useMemo(() => portfolioRows.map(p => p.entry), [portfolioRows]);
  const entryLineups = usePortfolio ? portfolioEntries : b.lineups;
  const entrySite = usePortfolio ? "draftkings" : b.context.site;
  const prelockEvidence = () => validatePrelockExport(usePortfolio ? b.portfolio : b.currentBuild,
    Object.values(assignments).filter(index => index !== "" && index != null).map(index => entryLineups[Number(index)]).filter(Boolean));
  const selectedEntries = template?.entries.filter(e => e.contestId === selectedContest) || [];
  const lineup = b.lineups[b.selected]?.lineup || [];
  const ids = new Set(lineup.map((p) => p.player_id));
  const eligible = b.pool.filter((p) => (!b.isDfs || p.salary != null) && (b.isCaptain || p.Position !== "K"));
  const coverage = dfsPoolCoverage(eligible);
  const showOwnership = Object.values(b.ownership).some(value => value != null);
  const poolColumns = 4 + Number(b.isDfs) + Number(b.isCaptain) + Number(showOwnership);
  useEffect(() => {
    setAvailability("available");
    setPos("ALL");
    if (poolScrollRef.current) poolScrollRef.current.scrollLeft = 0;
  }, [b.context.site, b.context.slateId, b.context.season, b.context.week]);
  const filtered = useMemo(
    () =>
      eligible
        .filter(
          (p) =>
            (pos === "ALL" || p.Position === pos) &&
            (availability === "all" || dfsPlayerStatus(p) === availability) &&
            String(p.Player).toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, z) => {
          const av = a[sort.key],
            zv = z[sort.key];
          if (av == null) return 1;
          if (zv == null) return -1;
          return (
            (typeof av === "string" ? av.localeCompare(zv) : av - zv) *
            (sort.descending ? -1 : 1)
          );
        }),
    [b.pool, b.isDfs, b.isCaptain, pos, availability, query, sort],
  );
  useEffect(() => setPage(0), [query, pos, availability, b.pool, sort]);
  useEffect(() => {
    setTemplate(null);
    setAssignments({});
    setSameSlate(false);
    setSelectedContest(""); setEntryPage(0); setExportState(null); exportSession.current = null;
  }, [entrySite, entryLineups, b.portfolioRestoreRevision]);
  useEffect(() => { exportReview.current++; setExportState(null); exportSession.current = null; }, [assignments, sameSlate, usePortfolio, b.portfolioLimits, b.portfolioRules, template, entryLineups]);
  useEffect(() => {
    if (b.portfolioRestoreRevision) { setUsePortfolio(true); setJourneyStage(1); requestAnimationFrame(() => portfolioRef.current?.focus()); }
  }, [b.portfolioRestoreRevision]);
  const restorePortfolio = async file => {
    if (!file || entryBusy) return;
    setRestoringPortfolio(true);
    const review = exportReview.current;
    b.setError("");
    try {
      const backup = await readPortfolioBackupFileAsync(file);
      if (review !== exportReview.current) throw new Error(GC.staleExport);
      const audit = auditPortfolio(backup.batches, backup.appearanceLimits, backup.reviewRules);
      if (b.portfolio.length && !(await confirmDialog({ title: PC.replaceTitle,
        message: PC.replaceMessage(b.portfolio.length, audit), confirmLabel: PC.replace,
        cancelLabel: PC.cancelRestore, danger: true }))) return;
      if (review !== exportReview.current) throw new Error(GC.staleExport);
      b.replacePortfolio(backup);
    } catch (e) { b.setError(e.message); }
    finally { setRestoringPortfolio(false); }
  };
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const salary = lineup.reduce((s, p) => s + Number(p.salary || 0), 0);
  const cap = Number(b.config.salary_cap || 0);
  const exportCheck = useMemo(() => {
    try {
      validateGlobalBuildForExport(b.currentBuild, b.lineups);
      return buildSiteLineupCsv(b.context.site, b.lineups, b.currentBuild?.salaryCatalog || b.pool);
    } catch (error) { return { ok: false, reason: error.message }; }
  }, [b.context.site, b.lineups, b.currentBuild, b.pool]);
  const exposure = useMemo(() => {
    const map = new Map();
    b.lineups.forEach((e) =>
      e.lineup.forEach((p) => {
        const r = map.get(p.player_id) || { ...p, count: 0, captains: 0 };
        r.count++;
        if (["CPT", "MVP"].includes(p.slot)) r.captains++;
        map.set(p.player_id, r);
      }),
    );
    return [...map.values()].sort((a, z) => z.count - a.count);
  }, [b.lineups]);
  useEffect(() => { setExposurePage(0); setLineupPage(0); }, [b.lineups]);
  const uploadTemplate = async (file) => {
    const review = exportReview.current;
    const serial = ++templateImportSerial.current;
    const isCurrentImport = () => review === exportReview.current && serial === templateImportSerial.current;
    try {
      if (file) {
        const loaded = readEntryTemplate(await file.text(), entrySite);
        if (!isCurrentImport()) return;
        setTemplate(loaded);
        const contests = [...new Set(loaded.entries.map(e => e.contestId))];
        setSelectedContest(contests.length === 1 ? contests[0] : "");
        setEntryPage(0);
        setAssignments({});
        setSameSlate(false);
      }
    } catch (e) {
      if (isCurrentImport()) b.setError(e.message);
    }
  };
  const synchronizeEntries = async (result, review) => {
    const requireCurrent = () => { if (review !== exportReview.current) throw new Error(GC.staleExport); };
    requireCurrent();
    if (usePortfolio) {
      const buildIds = {};
      for (const batch of b.portfolio) {
        requireCurrent();
        buildIds[batch.id] = await b.savePortfolioBatch(batch);
        requireCurrent();
      }
      const entries = portfolioEntryRecords(template, b.portfolio, assignments, buildIds);
      requireCurrent();
      return jsonRequest("/api/lineup/results/import", { method: "POST", body: JSON.stringify({ entries }) });
    }
    const build = b.savedBuild || await b.save(true);
    requireCurrent();
    if (!build) throw new Error(GC.authorization);
    const entries = result.manifest.assignments.map(e => ({ site: "draftkings", entry_id: e.entryId,
      contest_id: e.contestId, contest_name: e.contestName, fee_cents: moneyCents(e.fee),
      status: "unsettled", build_id: build.id, lineup_index: e.lineupIndex }));
    return jsonRequest("/api/lineup/results/import", { method: "POST", body: JSON.stringify({ entries }) });
  };
  const exportEntries = async (action = "prepare") => {
    if (entryBusy || !sameSlate) return;
    const review = exportReview.current;
    setExportingEntries(true);
    b.setError("");
    try {
      if (!exportSession.current) {
        const converted = usePortfolio ? buildPortfolioEntryCsv(template, b.portfolio, assignments, b.portfolioLimits, b.portfolioRules)
          : buildEntryCsv(template, b.lineups, assignments, b.currentBuild?.salaryCatalog || b.pool, { buildSource: b.currentBuild });
        const result = await sealEntryExportArtifact({ ...converted, manifest: { ...converted.manifest, prelockEvidence: prelockEvidence() } }, template);
        if (review !== exportReview.current) throw new Error(GC.staleExport);
        exportSession.current = createEntryExportSession({ artifact: result,
          authorize: async () => (await jsonRequest("/api/lineup/export-access")).allowed === true,
          synchronize: () => synchronizeEntries(result, review) });
      }
      const session = exportSession.current;
      const download = result => {
        if (session !== exportSession.current || review !== exportReview.current) throw new Error(GC.staleExport);
        prelockEvidence();
        downloadEntryArtifact(result);
      };
      if (action === "recovery" && session.snapshot().syncStatus === "pending") {
        const recovered = await session.download(download, { skipPendingSync: true });
        if (review === exportReview.current) setExportState(recovered);
        return;
      }
      const prepared = await session.retrySync();
      if (review !== exportReview.current) throw new Error(GC.staleExport);
      setExportState(prepared);
      if (action === "retry" || (prepared.syncStatus === "pending" && action !== "recovery")) return;
      const completed = await session.download(download);
      if (review === exportReview.current) setExportState(completed);
    } catch (e) {
      b.setError(e.message);
    } finally {
      setExportingEntries(false);
    }
  };
  let portfolioExportError = "";
  if (template) {
    try {
      prelockEvidence();
      if (usePortfolio) buildPortfolioEntryCsv(template, b.portfolio, assignments, b.portfolioLimits, b.portfolioRules);
      else {
        buildEntryCsv(template, b.lineups, assignments, b.currentBuild?.salaryCatalog || b.pool, { buildSource: b.currentBuild });
        if (b.currentBuild?.settings.portfolio_mode === "global" && Object.values(assignments).filter(i => i !== "" && i != null).length !== b.lineups.length)
          throw new Error(PC.countMismatch(Object.values(assignments).filter(i => i !== "" && i != null).length, b.lineups.length));
      }
    }
    catch (e) { portfolioExportError = e.message; }
  }
  const showLineups = () => {
    setJourneyStage(1);
    requestAnimationFrame(() => scrollToPanel(lineupsRef));
  };
  useEffect(() => {
    if (!b.lineups.length) { if (!b.portfolio.length) setJourneyStage(0); return; }
    setJourneyStage(1);
    if (["complete", "partial"].includes(b.buildJob?.status)) requestAnimationFrame(() => scrollToPanel(lineupsRef));
  }, [b.lineups]);
  const scrollToPanel = ref => {
    const target = ref.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - (slateRef.current?.offsetHeight || 0) - 16,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const reviewPortfolio = () => {
    setJourneyStage(1);
    requestAnimationFrame(() => scrollToPanel(b.lineups.length ? lineupsRef : portfolioRef));
  };
  const reviewEntries = () => { setJourneyStage(2); requestAnimationFrame(() => scrollToPanel(entriesRef)); };
  const reviewBuild = () => { setJourneyStage(0); requestAnimationFrame(() => scrollToPanel(buildPanelRef)); };
  const openResearch = () => {
    setJourneyStage(0);
    if (researchRef.current) researchRef.current.open = true;
    requestAnimationFrame(() => scrollToPanel(evidenceRef));
  };
  const returnToGames = () => {
    setJourneyStage(0);
    const button = evidenceButtonRef.current || buildPanelRef.current;
    const details = button?.closest("details");
    if (details) details.open = true;
    requestAnimationFrame(() => { button?.scrollIntoView({ block: "center" }); button?.focus({ preventScroll: true }); });
  };
  const selectedCount = entryLineups.length;
  const assignedCount = Object.values(assignments).filter(i => i !== "" && i != null && Number.isInteger(Number(i)) && Number(i) >= 0 && Number(i) < selectedCount).length;
  const combinedAudit = useMemo(() => auditPortfolio(b.portfolio, b.portfolioLimits, b.portfolioRules), [b.portfolio, b.portfolioLimits, b.portfolioRules]);
  const selectedUnique = usePortfolio ? combinedAudit.unique : countUniqueLineups(b.lineups);
  const capabilities = workspaceCapabilities({ pool: b.pool, salaries: b.salaries, isDfs: b.isDfs, template,
    assignmentError: portfolioExportError, prelockConfirmed: sameSlate, assigned: assignedCount, selected: selectedCount, exportState });
  const buildBlock = b.error || (!validLineupCount ? WC.countBlocked : !b.pool.length ? WC.noPool : b.planMatches === false ? RC.changed : "");
  const changeSort = (key) =>
    setSort((s) => ({ key, descending: s.key === key ? !s.descending : true }));
  return (
    <>
      <div className="dfw-slate" ref={slateRef}>
        <HubFilterMenu
          label={C.format}
          value={b.context.site}
          options={Object.entries(b.formats).map(([id, c]) => ({
            id,
            label: c.label,
          }))}
          onChange={(site) => b.changeContext({ site })}
          disabled={b.building}
        />
        {b.isDfs && (
          <HubFilterMenu
            label={C.slate}
            value={b.context.slateId}
            options={b.slates.map((s) => ({
              id: String(s.slate_id),
              label: s.name,
            }))}
            onChange={(slateId) => b.changeContext({ slateId })}
            disabled={b.busy || b.building}
          />
        )}
        <small>
          {b.context.source === "upload" ? b.slateName : b.config.description}
        </small>
        <DfsFile
          label={C.salaryImport}
          onFile={b.importSalary}
          disabled={!b.isDfs || b.busy || b.building || !b.context.week}
        />

        <details className="dfw-calendar"><summary>{F.schedule(b.context.season, b.context.week)}</summary><div className="dfw-settings-grid">          <HubFilterMenu
            label={C.season}
            value={b.context.season}
            options={options(
              b.meta?.seasons || [b.context.season].filter(Boolean),
            )}
            onChange={(season) => b.changeContext({ season: Number(season) })}
            disabled={b.building}
          />
          <HubFilterMenu
            label={C.week}
            value={b.context.week}
            options={options(
              b.meta?.weeks_by_season?.[String(b.context.season)] ||
                [b.context.week].filter(Boolean),
            )}
            onChange={(week) => b.changeContext({ week: Number(week) })}
            disabled={b.building}
          />
</div></details>
      </div>
      <DfsPoolFreshness b={b} />
      <DfsJourney stage={journeyStage} canReview={Boolean(b.lineups.length || b.portfolio.length)} onBuild={reviewBuild} onReview={reviewPortfolio} onEntries={reviewEntries}
        counts={{ requested: usePortfolio ? b.portfolio.reduce((n, batch) => n + Number(batch.settings.lineup_count || batch.lineups.length), 0) : b.currentBuild?.settings.lineup_count ?? (validLineupCount ? Number(b.settings.count) : null), generated: usePortfolio ? portfolioEntries.length : b.lineups.length, selected: selectedCount, unique: selectedUnique, assigned: assignedCount }} />
      <DfsInputUpdate b={b} />
      {b.error && journeyStage !== 0 && <p className="dfw-error" role="alert">{b.error}</p>}
      <div className="dfw-flow-layout" hidden={journeyStage !== 0}>
        <div className="dfw-flow-main">
          <section className="dfw-panel dfw-settings" ref={buildPanelRef} tabIndex={-1} aria-labelledby="dfw-settings-title">
            <h2 id="dfw-settings-title">{C.settings}</h2>
            <div className="dfw-settings-grid">          <DfsField label={C.count}>
            <input
              aria-label={C.count}
              aria-describedby="dfw-count-help"
              aria-invalid={!validLineupCount}
              type="number"
              inputMode="numeric"
              min="1"
              max={MAX_LINEUP_COUNT}
              step="1"
              required
              value={b.settings.count}
              onChange={(e) => b.changeSetting("count", e.target.value)}
              disabled={b.building}
            />
            <p id="dfw-count-help" className="dfw-note">
              {C.countHelp}
            </p>
          </DfsField>
          <HubFilterMenu
            label={F.goal}
            value={b.settings.objective}
            options={filterObjectives(b.isDfs).map((o) => ({
              ...o,
              shortLabel: o.label,
              detail: o.hint,
            }))}
            onChange={(v) => b.changeSetting("objective", v)}
          />
</div>
            <div className="dfw-build-action">
              <button ref={buildButtonRef} data-testid="dfs-generate" type="button" className="dfw-primary btn-primary"
                aria-describedby={buildBlock ? "dfw-build-block" : undefined}
                disabled={b.busy || b.building || !b.pool.length || !validLineupCount || b.planMatches === false} onClick={b.run}>
                {b.building ? C.building : WC.generate(b.settings.count)}
              </button>
              <p className="dfw-note">{F.buildSummary(b.locked.length, b.excluded.length, b.isDfs ? b.settings.maxSalary : null)}</p>
              {buildBlock && <p className={b.error ? "dfw-error" : "dfw-note"} id="dfw-build-block" role={b.error ? "alert" : "status"}>{buildBlock}</p>}
            </div>
            <DfsBuildStatus b={b} onCancel={() => { b.cancelBuild(); requestAnimationFrame(() => buildButtonRef.current?.focus()); }} />
            <details className="dfw-flow-disclosure" ref={advancedRef} data-testid="dfs-advanced">
              <summary><span className="dfw-summary"><strong>{F.advanced}</strong><small>{F.advancedHint}</small></span></summary>
              <div className="dfw-detail-body">
                <div className="dfw-settings-grid">          {b.isCaptain && (
            <HubFilterMenu
              label={C.captain}
              value={b.settings.lockedCaptain}
              options={[
                { id: "", label: C.anyCaptain },
                ...eligible
                  .filter((p) => ["Projected Points", "Low (P10)", "High (P90)"].every((key) => p[key] != null && Number.isFinite(Number(p[key]))))
                  .map((p) => ({ id: p.player_id, label: p.Player })),
              ]}
              onChange={(v) => b.changeSetting("lockedCaptain", v)}
            />
          )}
          <HubFilterMenu
            label={C.exposure}
            value={b.settings.exposure}
            options={[...new Set([1, 0.8, 0.7, 0.6, 0.5, 0.3, 0.2, Number(b.settings.exposure)])].sort((a, z) => z - a).map((v) => ({
              id: v,
              label: `${v * 100}% · ${Math.floor(v * b.settings.count + 1e-9)} / ${b.settings.count}`,
            }))}
            onChange={(v) => b.changeSetting("exposure", Number(v))}
          />
          <HubFilterMenu
            label={b.settings.portfolioMode === "global" && b.context.site === "draftkings" ? GC.overlap : C.differences}
            value={b.settings.portfolioMode === "global" && b.context.site === "draftkings" ? 9 - Number(b.settings.differences) : b.settings.differences}
            options={b.isCaptain || !b.isDfs ? lineupDifferenceOptions(b.isCaptain) : Array.from({ length: b.settings.portfolioMode === "global" ? 10 : 9 }, (_, i) => ({ id: b.settings.portfolioMode === "global" ? i : i + 1, label: String(b.settings.portfolioMode === "global" ? i : i + 1) }))}
            onChange={(v) => b.changeSetting("differences", b.settings.portfolioMode === "global" && b.context.site === "draftkings" ? 9 - Number(v) : Number(v))}
          />
          {b.isCaptain && b.settings.differences === 0 && <p className="dfw-note">{C.captainRotationHelp}</p>}
</div>
                          {b.isDfs && (
            <DfsField label={C.salary}>
              <div className="dfw-range">
                <input
                  aria-label={C.min}
                  type="number"
                  min="0"
                  max={cap}
                  step="100"
                  value={b.settings.minSalary}
                  onChange={(e) =>
                    b.changeSetting("minSalary", Number(e.target.value))
                  }
                />
                <span>–</span>
                <input
                  aria-label={C.max}
                  type="number"
                  min="0"
                  max={cap}
                  step="100"
                  value={b.settings.maxSalary}
                  onChange={(e) =>
                    b.changeSetting("maxSalary", Number(e.target.value))
                  }
                />
              </div>
            </DfsField>
          )}
          <details>
            <summary>{C.stacks}</summary>
            <div className="dfw-settings-grid">
              {!b.isCaptain && b.settings.portfolioMode !== "global" && (
                <>
                  <HubFilterMenu
                    label={C.qbStack}
                    value={b.settings.qbStack}
                    options={options([...new Set([0, 1, 2, 3, Number(b.settings.qbStack)])].sort((a, z) => a - z))}
                    onChange={(v) => b.changeSetting("qbStack", Number(v))}
                  />
                  {b.settings.requireQbStack && <p className="dfw-note">{RC.legacyRequired}</p>}
                  <label className="dfw-check">
                    <input
                      type="checkbox"
                      checked={b.settings.bringBack}
                      onChange={(e) =>
                        b.changeSetting("bringBack", e.target.checked)
                      }
                    />
                    {C.bringBack}
                  </label>
                </>
              )}
              {b.context.site === "draftkings" && b.settings.portfolioMode === "global" && <DfsClassicStack b={b} />}
              <HubFilterMenu
                label={C.maxTeam}
                value={b.settings.maxTeam}
                options={options(Array.from({ length: 10 }, (_, i) => i))}
                onChange={(v) => b.changeSetting("maxTeam", Number(v))}
              />
              <HubFilterMenu
                label={C.jitter}
                value={b.settings.randomness}
                options={[...new Set([0, 0.05, 0.12, 0.25, Number(b.settings.randomness)])].sort((a, z) => a - z).map((v) => ({
                  id: v,
                  label: `${v * 100}%`,
                }))}
                onChange={(v) => b.changeSetting("randomness", Number(v))}
              />
              <p className="dfw-note">{C.jitterNote}</p>
            </div>
          </details>
          {b.context.site === "draftkings" && <DfsBuildPlans b={b} />}

                {b.context.site === "draftkings" && <DfsGlobalExposure b={b} />}
              </div>
            </details>
          </section>
          <details className="dfw-panel dfw-flow-disclosure" data-testid="dfs-choose-players">
            <summary><span className="dfw-summary"><strong>{F.choose}</strong><small>{F.playerChoices(b.locked.length, b.excluded.length)}</small></span></summary>
            <div className="dfw-detail-body">          <div className="dfw-panel">
            <nav className="dfw-tabs" aria-label={C.pool}>
              {[
                ["pool", C.pool],
                ["notes", C.notes],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-current={tab === id ? "page" : undefined}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
              {(b.context.site === "draftkings" || b.portfolio.length > 0) && <button type="button" onClick={reviewPortfolio} disabled={!b.lineups.length && !b.portfolio.length}>{WC.portfolio}</button>}
              {Boolean(b.locked.length || b.excluded.length) && <button type="button" onClick={() => {
                b.locked.forEach(id => b.toggle(id, "lock"));
                b.excluded.forEach(id => b.toggle(id, "skip"));
              }}>{C.clear}</button>}
            </nav>
            {tab === "pool" && (
              <>
                <DfsPoolCoverage key={`${b.context.site}:${b.context.slateId}:${b.context.week}:${b.context.source}`} coverage={coverage} busy={b.busy} onUnavailable={() => { setAvailability("unavailable"); setPos("ALL"); setQuery(""); }}
                  importControl={<DfsFile label={C.projections} onFile={b.importProjections} disabled={!b.pool.length || b.busy || b.building} />} />
                <div className="dfw-pool-tools"><HubFilterMenu label={C.poolStatus} value={availability} options={[
                  { id: "available", label: C.available }, { id: "all", label: C.allPlayers }, { id: "unavailable", label: C.unavailable }, { id: "missing", label: C.missingInputs },
                ]} onChange={setAvailability} />
                <div className="dfw-filters">
                  {[
                    "ALL",
                    "QB",
                    "RB",
                    "WR",
                    "TE",
                    ...(b.isCaptain ? ["K"] : []),
                    ...(b.isDfs ? ["DST"] : []),
                  ].map((p) => (
                    <button
                      key={p}
                      aria-pressed={pos === p}
                      onClick={() => setPos(p)}
                    >
                      {p === "ALL" ? C.all : p}
                    </button>
                  ))}
                </div>
                </div>
                <input
                  className="dfw-search"
                  aria-label={C.search}
                  placeholder={C.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="dfw-table-scroll" ref={poolScrollRef}>
                  <table className="dfw-table dfw-player-table">
                    <thead>
                      <tr>
                        <th>
                          <button onClick={() => changeSort("Player")}>
                            {C.player}
                          </button>
                        </th>
                        {b.isDfs && (
                          <th className="num">
                            <button onClick={() => changeSort("salary")}>
                              {C.used}
                            </button>
                          </th>
                        )}
                        <th className="num">
                          <button
                            onClick={() => changeSort("Projected Points")}
                          >
                            {C.proj}
                          </button>
                        </th>
                        <th className="num dfw-player-range" title={C.rangeHint}>{C.range}</th>
                        {showOwnership && <th className="num">{C.own}</th>}
                        {b.isCaptain && <th>{C.captainLimit}</th>}
                        <th className="actions">{C.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.busy && !b.pool.length
                        ? Array.from({ length: 6 }, (_, i) => (
                            <tr key={i}>
                              <td colSpan={poolColumns}>
                                <div
                                  className="dfw-skeleton"
                                  aria-label={C.loading}
                                />
                              </td>
                            </tr>
                          ))
                        : filtered.slice(page * 8, page * 8 + 8).map((p) => (
                            <tr
                              key={p.player_id}
                              className={
                                ids.has(p.player_id) ? "is-selected" : ""
                              }
                            >
                              <td>
                                <strong>{p.Player}</strong>
                                <small>
                                  {p.Team} · {p.Position}
                                  {p.on_bye ? ` · ${C.bye}` : p["Injury Status"]
                                    ? ` · ${p["Injury Status"]}`
                                    : ""}
                                </small>
                                <small className="dfw-projection-source">{p.projection_source || C.sourceDescriptions.Other}</small>
                              </td>
                              {b.isDfs && (
                                <td className="num">
                                  {formatSalary(p.salary)}
                                </td>
                              )}
                              <td className="num">
                                {num(p["Projected Points"])}
                              </td>
                              <td className="num dfw-player-range">{num(p["Low (P10)"])}–{num(p["High (P90)"])}</td>
                              {showOwnership && <td className="num">
                                {b.ownership[p.player_id] == null
                                  ? "—"
                                  : `${b.ownership[p.player_id]}%`}
                              </td>}
                              {b.isCaptain && (
                                <td>
                                  <HubFilterMenu
                                    label={C.captainLimit}
                                    value={b.captainLimits[p.player_id] ?? 1}
                                    options={[0, 0.1, 0.25, 0.5, 1].map(
                                      (v) => ({
                                        id: v,
                                        label:
                                          v === 0 ? C.noCaptain : `${v * 100}%`,
                                      }),
                                    )}
                                    onChange={(v) =>
                                      b.setCaptainLimits((l) => ({
                                        ...l,
                                        [p.player_id]: Number(v),
                                      }))
                                    }
                                  />
                                </td>
                              )}
                              <td className="actions">
                                <div className="dfw-row-actions">
                                  <button
                                    aria-label={`${C.lock} ${p.Player}`}
                                    disabled={dfsPlayerStatus(p) !== "available" && !b.locked.includes(p.player_id)}
                                    aria-pressed={b.locked.includes(
                                      p.player_id,
                                    )}
                                    onClick={() =>
                                      b.toggle(p.player_id, "lock")
                                    }
                                  >
                                    {C.lock}
                                  </button>
                                  <button
                                    aria-label={`${C.skip} ${p.Player}`}
                                    aria-pressed={b.excluded.includes(
                                      p.player_id,
                                    )}
                                    onClick={() =>
                                      b.toggle(p.player_id, "skip")
                                    }
                                  >
                                    {C.skip}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
                {!b.busy && !filtered.length && (
                  <p className="dfw-note">{C.noPlayers}</p>
                )}
                <div className="dfw-pagination">
                  <small>
                    {filtered.length} {C.player.toLowerCase()}s ·{" "}
                    {Math.min(page + 1, pages)} / {pages}
                  </small>
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {C.previous}
                  </button>
                  <button
                    disabled={page + 1 >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {C.next}
                  </button>
                </div>
                <details>
                  <summary>{F.importInputs}</summary>
                  <DfsFile label={C.projections} onFile={b.importProjections} disabled={!b.pool.length || b.busy || b.building} />
                  {!Object.keys(b.ownership).length && <p className="dfw-note">{C.missingOwnership}</p>}
                  <p className="dfw-note">{C.projectionHelp}</p>
                </details>
              </>
            )}

            {tab === "notes" && (
              <DfsField label={C.notesLabel}>
                <textarea
                  rows="7"
                  value={b.settings.note}
                  onChange={(e) => b.changeSetting("note", e.target.value)}
                  maxLength={4000}
                />
                <p className="dfw-note">{C.notesHelp}</p>
              </DfsField>
            )}
          </div></div>
          </details>
        </div>
        <aside className="dfw-flow-rail">
          <DfsMatchupBoard b={b} evidenceButtonRef={evidenceButtonRef} onEvidence={openResearch} />
        </aside>
      </div>
      <div className="dfw-flow-layout" hidden={journeyStage !== 1}>
        <div className="dfw-flow-main">
                    <section
            ref={lineupsRef}
            id="dfw-lineups"
            tabIndex={-1}
            className="dfw-panel dfw-lineups"
            aria-labelledby="dfw-lineups-title"
          >
            <div className="dfw-panel-head">
              <h2 id="dfw-lineups-title">
                {b.lineups.length
                  ? `${b.lineups.length} ${C.count.toLowerCase()}`
                  : C.lineupsTitle}
              </h2>
            </div>
            {!b.lineups.length ? (
              <p className="dfw-note">{C.empty}</p>
            ) : (
              <>
              <dl className="dfw-review-facts">
                <div><dt>{F.built}</dt><dd>{b.lineups.length} / {b.currentBuild?.settings.lineup_count ?? b.lineups.length}</dd></div>
                <div><dt>{F.unique}</dt><dd>{countUniqueLineups(b.lineups)}</dd></div>
              </dl>
              <div className="dfw-lineups-body">
              <div className="dfw-portfolio">
                {b.lineups.slice(lineupPage * 10, lineupPage * 10 + 10).map((entry, localIndex) => {
                  const i = lineupPage * 10 + localIndex;
                  return (
                  <button
                    key={i}
                    aria-pressed={b.selected === i}
                    onClick={() => { b.setSelected(i); if (selectedLineupRef.current) selectedLineupRef.current.open = true; }}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      {lineupHeadline(entry)}
                      <small>
                        {/* The rest of the roster is what actually differs
                            between lineups; the teams never do. */}
                        {lineupSupporting(entry)} · {formatSalary(entry.total_salary)}
                      </small>
                    </span>
                    <span>
                      {num(
                        entry.lineup.reduce(
                          (s, p) => s + Number(p.proj || 0),
                          0,
                        ),
                      )}{" "}
                      pts
                    </span>
                  </button>
                ); })}
                {b.lineups.length > 10 && <div className="dfw-pagination" aria-label={GC.lineupPages}>
                  <small>{lineupPage + 1} / {Math.ceil(b.lineups.length / 10)}</small>
                  <button disabled={lineupPage === 0} onClick={() => setLineupPage(p => p - 1)}>{C.previous}</button>
                  <button disabled={(lineupPage + 1) * 10 >= b.lineups.length} onClick={() => setLineupPage(p => p + 1)}>{C.next}</button>
                </div>}
              </div>
                <details className="dfw-lineup dfw-flow-disclosure" ref={selectedLineupRef}>
                  <summary><span className="dfw-summary"><strong>{C.selected}</strong><small>{`${b.selected + 1} / ${b.lineups.length}`}</small></span></summary>
                  <div className="dfw-detail-body">
          {lineup.map((p, i) => (
            <div
              key={p.slot}
              className={
                i === 0 && b.isCaptain ? "dfw-captain" : "dfw-lineup-row"
              }
            >
              <small>{p.slot}</small>
              <div>
                <strong>{p.player}</strong>
                <small>
                  {p.team} · {p.position}
                </small>
              </div>
              <span>
                {b.isDfs ? formatSalary(p.salary) : `${num(p.proj)} pts`}
              </span>
            </div>
          ))}
          {b.isDfs && !!lineup.length && (
            <>
              <div className="dfw-numbers">
                <div>
                  <small>{C.used}</small>
                  <strong>{formatSalary(salary)}</strong>
                </div>
                <div>
                  <small>{C.unused}</small>
                  <strong>{formatSalary(cap - salary)}</strong>
                </div>
              </div>
              <meter min="0" max={cap} value={salary} aria-label={C.used} />
            </>
          )}
          {!!lineup.length && (
            <>
              <button disabled={Boolean(b.savedBuild)} onClick={b.save}>
                {b.savedBuild ? C.saved : C.save}
              </button>
              <p className="dfw-note">
                {b.savedBuild ? C.savedHelp : C.saveHelp}
              </p>
            </>
          )}
                  </div>
                </details>
              </div>
              </>
            )}
          </section>
          {!!b.lineups.length && <details className="dfw-panel dfw-flow-disclosure">
            <summary><span className="dfw-summary"><strong>{F.appearances}</strong></span></summary>
            <div className="dfw-detail-body">
<p className="dfw-note">{F.appearancesHelp}</p>
                <div className="dfw-table-scroll">
                  <table className="dfw-table dfw-actual-exposure">
                    <thead>
                      <tr>
                        <th>{C.player}</th>
                        <th className="num">{C.total}</th>
                        <th className="num">{GC.share}</th>
                        <th className="num">{C.captainCount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exposure.slice(exposurePage * 10, exposurePage * 10 + 10).map((p) => (
                        <tr key={p.player_id}>
                          <td>{p.player}</td>
                          <td className="num">{p.count}</td>
                          <td className="num">
                            {num((p.count / b.lineups.length) * 100)}%
                          </td>
                          <td className="num">{p.captains}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {exposure.length > 10 && <div className="dfw-pagination" aria-label={GC.actualPages}>
                  <small>{exposurePage + 1} / {Math.ceil(exposure.length / 10)}</small>
                  <button disabled={exposurePage === 0} onClick={() => setExposurePage(p => p - 1)}>{C.previous}</button>
                  <button disabled={(exposurePage + 1) * 10 >= exposure.length} onClick={() => setExposurePage(p => p + 1)}>{C.next}</button>
                </div>}</div>
          </details>}
          <div ref={portfolioRef} tabIndex={-1} className="dfw-workflow-target">
            {(b.context.site === "draftkings" || b.portfolio.length > 0) && <DfsPortfolio b={b} disabled={entryBusy} />}
          </div>
        </div>
        <aside className="dfw-flow-rail">
          <section className="dfw-panel">
            <h2>{F.ready}</h2><p className="dfw-note">{F.downloadHelp}</p>
            <button type="button" className="dfw-primary btn-primary" disabled={entryBusy || (!b.lineups.length && !b.portfolio.length)} onClick={reviewEntries}>{F.continue}</button>
            <button type="button" onClick={reviewBuild}>{F.adjust}</button>
          </section>
        </aside>
      </div>
      <div className="dfw-flow-layout" hidden={journeyStage !== 2}>
        <div className="dfw-flow-main">
          <section className="dfw-workflow-target" ref={entriesRef} tabIndex={-1} aria-label={WC.exportTitle}>
            <div className="dfw-panel">
            <small>{C.existing}</small>
            <h2>{C.edit}</h2>
            <p className="dfw-note">{C.editHelp}</p>
            {(b.context.site === "draftkings" || b.portfolio.length > 0 || usePortfolio) && <HubFilterMenu
              label={PC.source} value={usePortfolio ? "portfolio" : "build"}
              options={[{ id: "build", label: PC.currentBuild }, { id: "portfolio", label: PC.portfolio }]}
              disabled={entryBusy} onChange={v => setUsePortfolio(v === "portfolio")} />}
            <DfsFile
              label={C.template}
              onFile={uploadTemplate}
              disabled={
                entryBusy || !entrySite.startsWith("draftkings") || !entryLineups.length
              }
            />
            <details>
              <summary>{C.restriction.split(",")[0]}</summary>
              <p className="dfw-note">{C.restriction}</p>
            </details>
          </div>
                    {template && (
          <section className="dfw-panel">
            <div className="dfw-panel-head">
              <h2>{C.assignment}</h2>
              <button
                disabled={entryBusy || !selectedContest || selectedEntries.length < entryLineups.length}
                onClick={() =>
                  setAssignments(
                    Object.fromEntries(
                      selectedEntries
                        .slice(0, entryLineups.length)
                        .map((e, i) => [e.id, i]),
                    ),
                  )
                }
              >
                {C.sequential}
              </button>
            </div>
            <HubFilterMenu label={GC.contest} value={selectedContest} disabled={entryBusy} options={[
              { id: "", label: GC.allContests },
              ...[...new Set(template.entries.map(e => e.contestId))].map(id => ({ id, label: GC.selectedContest(template.entries.find(e => e.contestId === id).contest, template.entries.filter(e => e.contestId === id).length) }))
            ]} onChange={id => { setSelectedContest(id); setEntryPage(0); setAssignments({}); setSameSlate(false); }} />
            {!!selectedContest && selectedEntries.length < entryLineups.length && <p className="dfw-note">{PC.countMismatch(selectedEntries.length, entryLineups.length)}</p>}
            {usePortfolio && <p role="status">{PC.selected(Object.values(assignments).filter(v => v !== "" && v != null).length, entryLineups.length)}</p>}
            <div className="dfw-assignment-list">
              {selectedEntries.slice(entryPage * 10, entryPage * 10 + 10).map((e) => (
                <div className="dfw-assignment" key={e.id}>
                  <span>
                    {e.contest}
                    <small>
                      {e.id} · {e.fee}
                    </small>
                  </span>
                  <HubFilterMenu
                    label={C.selected}
                    value={assignments[e.id] ?? ""}
                    options={[
                      { id: "", label: C.keep },
                      ...entryLineups.map((_, i) => ({
                        id: i,
                        shortLabel: String(i + 1),
                        label: usePortfolio ? PC.assignment(i, portfolioRows[i].batch.label, portfolioRows[i].lineupIndex) : `${C.selected} ${i + 1}`,
                      })),
                    ]}
                    disabled={entryBusy}
                    onChange={(v) => setAssignments((a) => ({ ...a, [e.id]: v }))}
                  />
                </div>
              ))}
            </div>
            {selectedEntries.length > 10 && <div className="dfw-pagination"><span>{entryPage + 1} / {Math.ceil(selectedEntries.length / 10)}</span>
              <button disabled={entryBusy || entryPage === 0} onClick={() => setEntryPage(p => p - 1)}>{C.previous}</button>
              <button disabled={entryBusy || (entryPage + 1) * 10 >= selectedEntries.length} onClick={() => setEntryPage(p => p + 1)}>{C.next}</button></div>}
            <label className="dfw-check">
              <input
                type="checkbox"
                checked={sameSlate}
                disabled={entryBusy}
                onChange={(e) => setSameSlate(e.target.checked)}
              />
              {GC.prelock}
            </label>
            <p className="dfw-note">{GC.prelockHelp}</p>
            {!sameSlate && <p className="dfw-note">{WC.prelockMissing}</p>}
            {portfolioExportError && <p className="dfw-error" role="alert">{portfolioExportError}</p>}
            <button className="dfw-primary btn-primary" disabled={!sameSlate || entryBusy || Boolean(portfolioExportError)} onClick={() => exportEntries()}>
              {exportingEntries ? GC.syncing : WC.downloadReviewed}
            </button>
            {exportState && <div className="dfw-export-status" role="status">
              <p className="dfw-note">{exportState.syncStatus === "pending" ? GC.pending : exportState.downloaded ? GC.synced : GC.syncReady}</p>
              {!!exportState.artifact.manifest.preservedFormulaCells?.length && <p className="dfw-note">{GC.formulaNotice}</p>}
              {exportState.syncStatus === "pending" && <><p className="dfw-note">{exportState.syncError}</p><div className="dfw-actions">
                <button disabled={entryBusy || !sameSlate} onClick={() => exportEntries("recovery")}>{GC.recovery}</button>
                <button disabled={entryBusy || !sameSlate} onClick={() => exportEntries("retry")}>{GC.retry}</button></div></>}
              <button disabled={entryBusy} onClick={() => {
                const url = URL.createObjectURL(new Blob([JSON.stringify(exportState.artifact.manifest, null, 2)], { type: "application/json" }));
                const link = document.createElement("a"); link.href = url; link.download = "scoresense-entry-export-audit.json"; link.click(); URL.revokeObjectURL(url);
              }}>{GC.manifest}</button>
            </div>}
          </section>
        )}
          </section>
          <details className="dfw-panel dfw-flow-disclosure">
            <summary><span className="dfw-summary"><strong>{F.newCsv}</strong></span></summary>
            <div className="dfw-detail-body"><div className="dfw-panel">
            <small>{C.newLineups}</small>
            <h2>{C.upload}</h2>
            <p className="dfw-note">{C.uploadHelp}</p>
            <div className="dfw-actions">
              <button
                disabled={!exportCheck.ok}
                onClick={() =>
                  downloadCsv(exportCheck.filename, exportCheck.lines)
                }
              >
                {C.download}
              </button>
              <button
                disabled={!b.lineups.length}
                onClick={() => {
                  const d = buildLineupDetailCsv(b.lineups, { isDfs: b.isDfs });
                  if (d.ok) downloadCsv(d.filename, d.lines);
                }}
              >
                {C.detail}
              </button>
            </div>
            {b.lineups.length && !exportCheck.ok ? (
              <p className="dfw-note">{exportCheck.reason}</p>
            ) : null}
          </div>
</div>
          </details>
        </div>
        <aside className="dfw-flow-rail">
          <DfsCapabilityReview capabilities={capabilities} />
          <button type="button" onClick={reviewPortfolio}>{F.backReview}</button>
        </aside>
      </div>
      <div className="dfw-flow-extras">
        <details className="dfw-panel dfw-flow-disclosure" data-testid="dfs-research" ref={researchRef}>
          <summary><span className="dfw-summary"><strong>{F.research}</strong><small>{F.optional}</small></span></summary>
          <div className="dfw-detail-body">
            {b.context.site === "draftkings" && !b.isCaptain && <DfsEvidenceReview b={b} panelRef={evidenceRef} onReturn={returnToGames} />}
            {b.context.site === "draftkings" && !b.isCaptain && <DfsSharedOutcomesReview b={b} />}
            <DfsCaptainComparison b={b} />
            <DfsSourceSummary coverage={coverage} />
          </div>
        </details>
        {(b.context.site === "draftkings" || b.portfolio.length > 0) && <details className="dfw-panel dfw-flow-disclosure" data-testid="dfs-recovery">
          <summary><span className="dfw-summary"><strong>{F.recovery}</strong></span></summary>
          <div className="dfw-detail-body">
            <DfsLocalDraft b={b} />
                        <div className="dfw-actions">
              <button type="button" disabled={entryBusy || (!b.portfolio.length && !b.currentBuild) || (!b.portfolio.length && b.currentBuild?.context.site !== "draftkings")} onClick={async event => {
                const button = event.currentTarget;
                const review = exportReview.current; setBackupWorking(true);
                backupFocus.current = { button, review };
                try { const batches = b.portfolio.length ? b.portfolio : [createPortfolioBatch(b.currentBuild, WC.firstBatch)];
                  await downloadPortfolioBackupAsync(batches, b.portfolioLimits, b.portfolioRules,
                  { beforeDownload: () => { if (review !== exportReview.current) throw new Error(GC.staleExport); } }); }
                catch (e) { b.setError(e.message); }
                finally { setBackupWorking(false); }
              }}>{backupWorking ? WC.backupWorking : PC.backup}</button>
              <DfsFile label={PC.restore} accept=".json,application/json" disabled={entryBusy} onFile={restorePortfolio} />
            </div>
            <p className="dfw-note">{PC.backupHelp}</p>
          </div>
        </details>}
      </div>
    </>
  );
}
