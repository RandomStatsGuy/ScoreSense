import { useEffect, useRef, useState } from "react";
import { jsonRequest } from "./useDfsBuilder.js";
import { comparisonInputs, comparisonRequest, compatibleEvidence, evidenceContext, selectDecisionSnapshot, validateComparisonResponse } from "./dfsEvidence.js";
import { DFS_EVIDENCE_COPY as C } from "./dfsToolPresentation.js";

export default function useDfsEvidence(b) {
  const context = evidenceContext(b), contextKey = JSON.stringify(context);
  let inputs = null, inputError = "";
  try { inputs = comparisonInputs(b); } catch (error) { inputError = error.message; }
  const inputKey = JSON.stringify(inputs);
  const [evidence, setEvidence] = useState(null), [status, setStatus] = useState("idle");
  const [error, setError] = useState(""), [selected, setSelected] = useState(null);
  const [report, setReport] = useState(null), [comparing, setComparing] = useState(false);
  const [selectedKey, setSelectedKey] = useState(""), [selecting, setSelecting] = useState(false);
  const [reload, setReload] = useState(0), [account, setAccount] = useState(0);
  const [elapsed, setElapsed] = useState(0), [notice, setNotice] = useState("");
  const epoch = useRef(0), request = useRef(null), current = useRef(null), evidenceRequest = useRef(0);
  current.current = { contextKey, inputKey, account };
  useEffect(() => {
    const reset = () => { epoch.current++; evidenceRequest.current++; request.current?.abort(); setSelected(null); setSelectedKey("");
      setReport(null); setEvidence(null); setComparing(false); setSelecting(false); setError(""); setNotice(""); setAccount(n => n + 1); };
    window.addEventListener("scoresense-auth-changed", reset);
    return () => { window.removeEventListener("scoresense-auth-changed", reset); epoch.current++; request.current?.abort(); };
  }, []);
  useEffect(() => {
    epoch.current++; request.current?.abort(); setSelected(null); setSelectedKey(""); setReport(null); setComparing(false); setSelecting(false); setNotice("");
  }, [contextKey, account]);
  useEffect(() => { epoch.current++; request.current?.abort(); setComparing(false); setSelecting(false); }, [inputKey]);
  useEffect(() => {
    if (!comparing) return;
    const started = Date.now(); setElapsed(0);
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(interval);
  }, [comparing]);
  useEffect(() => {
    const abort = new AbortController(), version = ++evidenceRequest.current;
    setEvidence(previous => compatibleEvidence(previous, context) ? previous : null); setError("");
    if (!context) { setStatus("idle"); return () => abort.abort(); }
    setStatus("loading");
    jsonRequest(`/api/lineup/evidence?${new URLSearchParams({ site: context.site, season: context.season, week: context.week, slate_id: context.slate_id })}`, { signal: abort.signal })
      .then(value => {
        if (abort.signal.aborted || version !== evidenceRequest.current) return;
        if (!compatibleEvidence(value, context)) throw new Error(C.contextMismatch);
        setEvidence(value); setStatus(value.status === "available" ? "available" : "unavailable");
      }).catch(err => { if (!abort.signal.aborted && version === evidenceRequest.current) { setStatus("error"); setError(err.message || C.failed); } });
    return () => abort.abort();
  }, [contextKey, reload, account]);
  const stale = Boolean(selected && selectedKey !== inputKey);
  const select = async () => {
    if (!inputs) { setError(inputError); return; }
    const version = ++epoch.current, start = current.current;
    setSelecting(true); setError(""); setNotice(""); request.current?.abort(); setComparing(false);
    try {
      const snapshot = await selectDecisionSnapshot(inputs, evidence, new Date().toISOString(), b.pool);
      if (version !== epoch.current || start !== current.current && (start.inputKey !== current.current.inputKey || start.contextKey !== current.current.contextKey || start.account !== current.current.account)) return;
      setSelected(snapshot); setSelectedKey(inputKey); setReport(null);
    } catch (err) { if (version === epoch.current) setError(err.message); }
    finally { if (version === epoch.current) setSelecting(false); }
  };
  const compare = async () => {
    if (!selected || stale) return;
    const version = ++epoch.current, start = current.current;
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    setComparing(true); setError(""); setNotice("");
    try {
      const value = await jsonRequest("/api/lineup/compare-classic", { method: "POST", signal: abort.signal, body: JSON.stringify(comparisonRequest(selected)) });
      if (abort.signal.aborted || version !== epoch.current || start.inputKey !== current.current.inputKey || start.contextKey !== current.current.contextKey || start.account !== current.current.account) return;
      setReport(validateComparisonResponse(selected, value));
    } catch (err) { if (!abort.signal.aborted && version === epoch.current) setError(err.message); }
    finally { if (version === epoch.current) setComparing(false); }
  };
  const cancel = () => { epoch.current++; request.current?.abort(); setComparing(false); setNotice(C.cancelled); };
  return { evidence, status, error, notice, elapsed, cancel, selected, report, comparing, selecting, stale, inputError,
    newest: Boolean(selected && evidence && selected.evidence_id !== (evidence.content_id || null)),
    refresh: () => setReload(n => n + 1), select, compare };
}
