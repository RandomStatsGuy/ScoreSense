import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "./useDfsBuilder.js";
import { sharedOutcomeInputs, validateScenarioPreview, selectScenarioSnapshot, sharedEvaluationRequest,
  validateSharedReport, runSharedOutcomeTask, SHARED_MAX_BYTES } from "./dfsSharedOutcomes.js";
import { DFS_SHARED_OUTCOMES_COPY as C } from "./dfsToolPresentation.js";

export default function useDfsSharedOutcomes(b) {
  const [scope, setScope] = useState("build"), [seed, setSeed] = useState(0), [drawCount, setDrawCount] = useState(256);
  const [candidate, setCandidate] = useState(null), [preview, setPreview] = useState(null), [selected, setSelected] = useState(null);
  const [review, setReview] = useState(null), [status, setStatus] = useState("idle"), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [elapsed, setElapsed] = useState(0), [account, setAccount] = useState(0);
  const epoch = useRef(0), job = useRef(null), current = useRef(null), mounted = useRef(true);
  let inputs = null, inputError = "";
  try { inputs = { ...sharedOutcomeInputs(b, scope), review_settings: { seed, draw_count: drawCount } }; }
  catch (err) { inputError = err.message; }
  const key = JSON.stringify(inputs), contextKey = JSON.stringify(b.context);
  current.current = { key, contextKey, account };
  const abortJob = () => { epoch.current++; job.current?.abort(); job.current = null; };
  const clear = () => { abortJob(); setCandidate(null); setPreview(null); setSelected(null); setReview(null); setStatus("idle"); setError(""); setNotice(""); };
  useEffect(() => {
    mounted.current = true;
    const reset = () => { clear(); setAccount(n => n + 1); };
    window.addEventListener("scoresense-auth-changed", reset);
    return () => { mounted.current = false; window.removeEventListener("scoresense-auth-changed", reset); abortJob(); };
  }, []);
  useEffect(() => { clear(); }, [contextKey, account]);
  useEffect(() => { abortJob(); setStatus("idle"); }, [key]);
  useEffect(() => {
    if (status === "idle") return;
    const start = Date.now(); setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(timer);
  }, [status]);
  const begin = nextStatus => {
    abortJob(); const controller = new AbortController(); job.current = controller;
    const version = epoch.current, start = { ...current.current };
    setStatus(nextStatus); setError(""); setNotice("");
    return { controller, valid: () => mounted.current && !controller.signal.aborted && version === epoch.current &&
      start.key === current.current.key && start.contextKey === current.current.contextKey && start.account === current.current.account };
  };
  const finish = run => { if (run.valid()) setStatus("idle"); };
  const failed = (run, err) => { if (run.valid()) setError(err.message || C.failed); };
  const readFile = async file => {
    if (!file || !inputs) return;
    const run = begin("reading");
    try {
      if (file.size > SHARED_MAX_BYTES) throw new Error(C.sizeError);
      const text = await file.text(); if (!run.valid()) return;
      const bank = await runSharedOutcomeTask("read", { text, inputs }, run.controller.signal);
      if (!run.valid()) return;
      setCandidate({ bank, name: file.name }); setPreview(null); setNotice(C.fileReady);
    } catch (err) { failed(run, err); } finally { finish(run); }
  };
  const runPreview = async () => {
    if (!candidate || !inputs) return;
    const run = begin("previewing");
    try {
      const body = await runSharedOutcomeTask("preview-body", { inputs, bank: candidate.bank }, run.controller.signal);
      if (!run.valid()) return;
      const value = await jsonRequest("/api/lineup/shared-outcomes/preview", { method: "POST", body, signal: run.controller.signal });
      if (!run.valid()) return;
      setPreview({ summary: validateScenarioPreview(value, inputs), bank: candidate.bank, name: candidate.name, key });
      setNotice(C.previewReady);
    } catch (err) { failed(run, err); } finally { finish(run); }
  };
  const select = async () => {
    if (!preview || preview.key !== key || !inputs) return;
    const run = begin("selecting");
    try {
      // Validate review settings before accepting a new selected snapshot.
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2 ** 31 - 1) throw new Error(C.settingsError);
      const snapshot = await selectScenarioSnapshot(inputs, preview.summary);
      if (!run.valid()) return;
      setSelected({ snapshot, summary: preview.summary, bank: preview.bank, name: preview.name, key }); setNotice(C.selected);
    } catch (err) { failed(run, err); } finally { finish(run); }
  };
  const stale = Boolean(selected && selected.key !== key);
  const evaluate = async () => {
    if (!selected || stale) return;
    const run = begin("evaluating");
    try {
      const request = sharedEvaluationRequest(selected.snapshot, selected.bank, seed, drawCount);
      const body = await runSharedOutcomeTask("body", { request }, run.controller.signal);
      if (!run.valid()) return;
      const response = await jsonRequest("/api/lineup/shared-outcomes/evaluate", { method: "POST", body, signal: run.controller.signal });
      if (!run.valid()) return;
      const report = validateSharedReport(response, request);
      setReview({ snapshot: selected.snapshot, preview: selected.summary, report, name: selected.name }); setNotice(C.complete);
    } catch (err) { failed(run, err); } finally { finish(run); }
  };
  const download = async () => {
    if (!review) return;
    const run = begin("downloading");
    try {
      const text = await runSharedOutcomeTask("download", review, run.controller.signal);
      if (!run.valid()) return;
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "scoresense-scenario-review.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { failed(run, err); } finally { finish(run); }
  };
  const cancel = () => { abortJob(); setStatus("idle"); setNotice(C.cancelled); };
  return { scope, setScope, seed, setSeed, drawCount, setDrawCount, candidate, preview, selected, review, status, error, notice,
    elapsed, inputError, inputs, stale, busy: status !== "idle", previewStale: Boolean(preview && preview.key !== key),
    previousReview: Boolean(review && (stale || review.snapshot.input_snapshot_id !== selected?.snapshot.input_snapshot_id)),
    readFile, runPreview, select, evaluate, download, cancel };
}
