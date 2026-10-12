import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "./useDfsBuilder.js";
import { frozenProjectionScores, frozenPortfolioConstraints, runContestPortfolioTask, validateContestPortfolio } from "./dfsContestPortfolio.js";
import { DFS_CONTEST_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";

export default function useDfsContestPortfolio(shared, contest) {
  const [count, setCount] = useState(1), [scenarioId, setScenarioId] = useState("");
  const [objective, setObjective] = useState("conditional_mean_net"), [riskAlpha, setRiskAlpha] = useState("0.9"), [riskWeight, setRiskWeight] = useState("1");
  const [review, setReview] = useState(null), [attempt, setAttempt] = useState(null), [status, setStatus] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const epoch = useRef(0), job = useRef(null), mounted = useRef(true), current = useRef("");
  const selected = shared.selected, chosen = contest.chosen;
  const key = JSON.stringify([selected?.snapshot.input_snapshot_id, selected?.key, chosen?.summary.content_id, chosen?.key,
    shared.stale, shared.seed, contest.stale, contest.draws, contest.topK, count, scenarioId, objective, riskAlpha, riskWeight]);
  current.current = key;
  const cancel = () => { epoch.current++; job.current?.abort(); job.current = null; setStatus(""); };
  const clear = () => { cancel(); setReview(null); setAttempt(null); setError(""); setNotice(""); };
  useEffect(() => {
    mounted.current = true; window.addEventListener("scoresense-auth-changed", clear);
    return () => { mounted.current = false; window.removeEventListener("scoresense-auth-changed", clear); epoch.current++; job.current?.abort(); };
  }, []);
  useEffect(() => { cancel(); }, [key]);
  useEffect(() => {
    if (!status) return;
    const start = Date.now(); setElapsed(0); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => {
    setScenarioId(""); setCount(n => Number.isSafeInteger(n) && n > 0 ? Math.max(1, Math.min(n, selected?.snapshot.lineups.length || 1)) : 1);
  }, [chosen?.summary.content_id, selected?.snapshot.input_snapshot_id]);
  const unavailable = !selected || !chosen || shared.stale || shared.busy || contest.stale || contest.busy;
  let inputError = "";
  if (selected) {
    try { frozenProjectionScores(selected.snapshot); frozenPortfolioConstraints(selected.snapshot, count); }
    catch (err) { inputError = err.message; }
  }
  const run = async (label, task) => {
    cancel(); const version = epoch.current, start = key, controller = new AbortController(); job.current = controller;
    const valid = () => mounted.current && !controller.signal.aborted && version === epoch.current && start === current.current;
    setStatus(label); setError(""); setNotice("");
    try { await task(controller.signal, valid); } catch (err) { if (valid()) setError(err.message || C.failed); }
    finally { if (valid()) setStatus(""); }
  };
  const select = () => !unavailable && !inputError && run(C.running, async (signal, valid) => {
    const settings = { count, scenarioId, objective, seed: shared.seed, draws: contest.draws, topK: contest.topK, riskAlpha, riskWeight };
    const request = await runContestPortfolioTask("request", { selected, chosen, settings }, signal); if (!valid()) return;
    const body = await runContestPortfolioTask("body", { request }, signal); if (!valid()) return;
    const response = await jsonRequest("/api/lineup/contest-research/select", { method: "POST", body, signal }); if (!valid()) return;
    const report = validateContestPortfolio(response, request); setAttempt({ report, key });
    if (report.complete) setReview({ report, snapshot: selected.snapshot, preview: chosen.summary, key, name: chosen.file.name });
    else setError(report.error || C.noSet);
  });
  const download = () => review && run(C.downloading, async (signal, valid) => {
    const text = await runContestPortfolioTask("download", { review }, signal); if (!valid()) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "scoresense-proposed-lineup-set.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return { count, setCount, scenarioId, setScenarioId, objective, setObjective, riskAlpha, setRiskAlpha, riskWeight, setRiskWeight,
    review, attempt: attempt?.key === key ? attempt.report : null, status, elapsed, error, notice, inputError, unavailable,
    previous: Boolean(review && (review.key !== key || unavailable)), select, download,
    cancel: () => { cancel(); setNotice(C.cancelled); }, busy: Boolean(status) };
}
