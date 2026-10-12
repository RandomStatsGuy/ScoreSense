import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "./useDfsBuilder.js";
import { runContestTask, contestPreviewRequest, validateContestPreview, contestEvaluationRequest, validateContestReport } from "./dfsContestResearch.js";
import { SHARED_MAX_BYTES } from "./dfsSharedOutcomes.js";
import { DFS_CONTEST_COPY as C } from "./dfsToolPresentation.js";

export default function useDfsContestResearch(shared) {
  const [candidate, setCandidate] = useState(null), [preview, setPreview] = useState(null), [chosen, setChosen] = useState(null);
  const [review, setReview] = useState(null), [status, setStatus] = useState(""), [error, setError] = useState("");
  const [draws, setDraws] = useState(128), [topK, setTopK] = useState(10);
  const [elapsed, setElapsed] = useState(0);
  const epoch = useRef(0), job = useRef(null), mounted = useRef(true), current = useRef("");
  const selected = shared.selected;
  const key = JSON.stringify([selected?.snapshot.input_snapshot_id, selected?.summary.content_id, selected?.key, shared.stale, shared.seed, draws, topK]);
  current.current = key;
  const cancel = () => { epoch.current++; job.current?.abort(); job.current = null; setStatus(""); };
  const clear = () => { cancel(); setCandidate(null); setPreview(null); setChosen(null); setReview(null); setError(""); };
  useEffect(() => {
    mounted.current = true; window.addEventListener("scoresense-auth-changed", clear);
    return () => { mounted.current = false; window.removeEventListener("scoresense-auth-changed", clear); epoch.current++; job.current?.abort(); };
  }, []);
  useEffect(() => { cancel(); }, [key]);
  useEffect(() => {
    if (!status) return;
    const start = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => { if (!selected) clear(); }, [selected]);
  const run = async (label, task) => {
    cancel(); const version = epoch.current, start = key, controller = new AbortController(); job.current = controller;
    const valid = () => mounted.current && !controller.signal.aborted && version === epoch.current && start === current.current;
    setStatus(label); setError("");
    try { await task(controller.signal, valid); } catch (err) { if (valid()) setError(err.message || C.failed); }
    finally { if (valid()) setStatus(""); }
  };
  const unavailable = !selected || shared.stale || shared.busy || !selected.snapshot.lineups.length;
  const readFile = file => {
    if (!file || unavailable) return;
    return run(C.reading, async (signal, valid) => {
      if (file.size > SHARED_MAX_BYTES) throw new Error(C.sizeError);
      const text = await file.text(); if (!valid()) return;
      const value = await runContestTask("read", { text, selected }, signal);
      if (valid()) {
        setCandidate({ value, name: file.name }); setPreview(null); setChosen(null);
        setTopK(n => Number.isSafeInteger(n) && n >= 1 ? Math.min(n, value.payout_contract.entrant_count) : Math.min(10, value.payout_contract.entrant_count));
      }
    });
  };
  const runPreview = () => !unavailable && candidate && run(C.previewing, async (signal, valid) => {
    const body = await runContestTask("body", { request: contestPreviewRequest(selected, candidate.value) }, signal);
    if (!valid()) return;
    const value = await jsonRequest("/api/lineup/contest-research/preview", { method: "POST", body, signal });
    if (valid()) setPreview({ summary: validateContestPreview(value, selected, candidate.value), file: candidate, key });
  });
  const choose = () => { if (preview?.key === key && !unavailable) setChosen(preview); };
  const stale = Boolean(chosen && (chosen.key !== key || unavailable));
  const evaluate = () => chosen && !stale && run(C.evaluating, async (signal, valid) => {
    const request = contestEvaluationRequest(selected, chosen.file.value, chosen.summary, shared.seed, draws, topK);
    const body = await runContestTask("body", { request }, signal); if (!valid()) return;
    const response = await jsonRequest("/api/lineup/contest-research/evaluate", { method: "POST", body, signal });
    if (valid()) setReview({ report: validateContestReport(response, request), snapshot: selected.snapshot,
      preview: chosen.summary, key, name: chosen.file.name });
  });
  const download = () => review && run(C.downloading, async (signal, valid) => {
    const text = await runContestTask("download", { review }, signal); if (!valid()) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "scoresense-contest-research.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return { candidate, preview, chosen, review, status, elapsed, error, draws, setDraws, topK, setTopK,
    unavailable, stale, previewStale: preview?.key !== key,
    previous: review && (review.key !== key || !chosen || review.preview.content_id !== chosen.summary.content_id),
    readFile, runPreview, choose, evaluate, download, cancel, busy: Boolean(status) };
}
