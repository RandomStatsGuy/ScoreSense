import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "./useDfsBuilder.js";
import { evidenceContext } from "./dfsEvidence.js";
import { SHARED_MAX_BYTES, runLateSwapTask, lateSwapPreviewRequest, validateLateSwapPreview, validateLateSwapPlan } from "./dfsLateSwap.js";
import { DFS_LATE_SWAP_COPY as C } from "./dfsToolPresentation.js";

export default function useDfsLateSwap(b) {
  const [candidate, setCandidate] = useState(null), [preview, setPreview] = useState(null), [chosen, setChosen] = useState(null);
  const [review, setReview] = useState(null), [attempt, setAttempt] = useState(null), [status, setStatus] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const context = b.context?.site === "draftkings" && !b.isCaptain ? evidenceContext(b) : null;
  const contextKey = JSON.stringify(context), key = JSON.stringify([contextKey, candidate?.version, chosen?.summary.content_id]);
  const epoch = useRef(0), job = useRef(null), mounted = useRef(true), current = useRef(key);
  current.current = key;
  const cancel = () => { epoch.current++; job.current?.abort(); job.current = null; setStatus(""); };
  const clear = () => { cancel(); setCandidate(null); setPreview(null); setChosen(null); setReview(null); setAttempt(null); setError(""); setNotice(""); };
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
  const run = async (label, task) => {
    cancel(); const version = epoch.current, start = key, controller = new AbortController(); job.current = controller;
    const valid = () => mounted.current && !controller.signal.aborted && epoch.current === version && current.current === start;
    setStatus(label); setError(""); setNotice("");
    try { await task(controller.signal, valid); }
    catch (err) { if (valid()) setError(err.message || C.failed); }
    finally { if (valid()) setStatus(""); }
  };
  const unavailable = !context;
  const readFile = file => {
    if (!file || unavailable) return;
    return run(C.reading, async (signal, valid) => {
      if (file.size > SHARED_MAX_BYTES) throw new Error(C.sizeError);
      const text = await file.text(); if (!valid()) return;
      const result = await runLateSwapTask("read", { text, context }, signal); if (!valid()) return;
      setCandidate({ value: result.value, version: result.version, name: file.name }); setPreview(null); setChosen(null); setAttempt(null);
    });
  };
  const previewStale = !preview || preview.contextKey !== contextKey || preview.file.version !== candidate?.version || unavailable;
  const stale = Boolean(chosen && (chosen.contextKey !== contextKey || chosen.file.version !== candidate?.version || unavailable));
  const runPreview = () => candidate && !unavailable && run(C.previewing, async (signal, valid) => {
    const request = lateSwapPreviewRequest(candidate.value, context);
    const body = await runLateSwapTask("body", { request }, signal); if (!valid()) return;
    const response = await jsonRequest("/api/lineup/late-swap/preview", { method: "POST", body, signal }); if (!valid()) return;
    const summary = validateLateSwapPreview(response, request);
    setPreview({ summary, file: candidate, contextKey });
  });
  const choose = () => { if (!previewStale && !status) { setChosen(preview); setNotice(C.ready); } };
  const plan = () => chosen && !stale && run(C.planning, async (signal, valid) => {
    const request = { ...lateSwapPreviewRequest(chosen.file.value, context), package_id: chosen.summary.content_id };
    const body = await runLateSwapTask("body", { request }, signal); if (!valid()) return;
    const response = await jsonRequest("/api/lineup/late-swap/plan", { method: "POST", body, signal }); if (!valid()) return;
    const report = validateLateSwapPlan(response, request, chosen.summary);
    setAttempt({ report, key });
    if (report.complete) setReview({ report, summary: chosen.summary, package: chosen.file.value, name: chosen.file.name, key, contextKey });
    else setError(report.error || C.noSet);
  });
  const download = () => review && run(C.downloading, async (signal, valid) => {
    const access = await jsonRequest("/api/lineup/export-access", { signal }); if (!valid()) return;
    if (access?.allowed !== true) throw new Error(C.accessError);
    const text = await runLateSwapTask("download", { review }, signal); if (!valid()) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "scoresense-late-swap-plan.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return { candidate, preview, chosen, review, attempt: attempt?.key === key ? attempt.report : null, status, elapsed, error, notice,
    unavailable, stale, previewStale, previous: Boolean(review && (review.key !== key || stale || unavailable)), readFile, runPreview, choose, plan, download,
    cancel: () => { cancel(); setNotice(C.cancelled); }, busy: Boolean(status) };
}
