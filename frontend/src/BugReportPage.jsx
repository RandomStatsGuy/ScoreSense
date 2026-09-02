import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import StandalonePageShell from "./layout/StandalonePageShell";
import { apiFetch } from "./auth";
import { PRODUCT_NAME, STUDIO_NAME } from "./brand";
import { parseApiError } from "./format";
import {
  BUG_REPORT_COPY,
  REPORT_AREAS,
  inferReportArea,
  reportSuccess,
  safeReportFrom,
} from "./bugReportPresentation";

export default function BugReportPage() {
  const { ready, authenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const pagePath = useMemo(
    () => safeReportFrom(searchParams.get("from")),
    [searchParams],
  );

  const [title, setTitle] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [expected, setExpected] = useState("");
  const [area, setArea] = useState(() => inferReportArea(pagePath));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filedKey, setFiledKey] = useState("");
  const [boardOpen, setBoardOpen] = useState(true);

  useEffect(() => {
    setArea(inferReportArea(pagePath));
  }, [pagePath]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await apiFetch("/api/support/bugs/status", { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json();
        setBoardOpen(data.enabled !== false);
      } catch {
        /* keep optimistic */
      }
    })();
    return () => ctrl.abort();
  }, []);

  const sendReport = async (event) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanHappened = whatHappened.trim();
    if (cleanTitle.length < 8) {
      setError(BUG_REPORT_COPY.needTitle);
      return;
    }
    if (cleanHappened.length < 20) {
      setError(BUG_REPORT_COPY.needHappened);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/support/bugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: cleanTitle,
          what_happened: cleanHappened,
          expected: expected.trim(),
          area,
          page_path: pagePath,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setFiledKey(data.key || "");
      setTitle("");
      setWhatHappened("");
      setExpected("");
    } catch (err) {
      const message = err.message || BUG_REPORT_COPY.sendFailed;
      if (/not taking reports/i.test(message)) {
        setBoardOpen(false);
        setError(BUG_REPORT_COPY.boardClosed);
      } else if (/too many reports/i.test(message)) {
        setError(BUG_REPORT_COPY.tooMany);
      } else if (/sign in/i.test(message)) {
        setError(BUG_REPORT_COPY.needAccount);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return <div className="panel muted">Loading…</div>;
  }

  return (
    <StandalonePageShell title={BUG_REPORT_COPY.eyebrow}>
      <div className="auth-shell auth-shell-page account-settings-page">
        <div className="panel auth-panel account-settings-panel">
          <p className="auth-session-eyebrow">{BUG_REPORT_COPY.eyebrow}</p>
          <h2 className="auth-panel-title-desktop">{BUG_REPORT_COPY.heading}</h2>
          <p className="chart-note">{BUG_REPORT_COPY.support}</p>

          {!authenticated ? (
            <>
              <p className="chart-note">{BUG_REPORT_COPY.needAccount}</p>
              <p className="hub-toolbar">
                <Link className="btn-primary" to={`/login?next=${encodeURIComponent(reportNext(pagePath))}`}>
                  {BUG_REPORT_COPY.signIn}
                </Link>
              </p>
              <p className="chart-note">
                <Link to={`/register?next=${encodeURIComponent(reportNext(pagePath))}`}>
                  {BUG_REPORT_COPY.createAccount}
                </Link>
              </p>
            </>
          ) : filedKey ? (
            <p className="chart-note">{reportSuccess(filedKey)}</p>
          ) : (
            <form className="account-auth-form" onSubmit={sendReport}>
              {!boardOpen ? (
                <p className="chart-note">{BUG_REPORT_COPY.boardClosed}</p>
              ) : null}
              <label>
                <span className="hub-field-label">{BUG_REPORT_COPY.titleLabel}</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={BUG_REPORT_COPY.titlePlaceholder}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                <span className="hub-field-label">{BUG_REPORT_COPY.happenedLabel}</span>
                <textarea
                  value={whatHappened}
                  onChange={(e) => setWhatHappened(e.target.value)}
                  placeholder={BUG_REPORT_COPY.happenedPlaceholder}
                  maxLength={4000}
                  required
                />
              </label>
              <label>
                <span className="hub-field-label">{BUG_REPORT_COPY.expectedLabel}</span>
                <textarea
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder={BUG_REPORT_COPY.expectedPlaceholder}
                  maxLength={2000}
                />
              </label>
              <div className="hub-league-field-split">
                <label>
                  <span className="hub-field-label">{BUG_REPORT_COPY.areaLabel}</span>
                  <select value={area} onChange={(e) => setArea(e.target.value)}>
                    {REPORT_AREAS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                {pagePath ? (
                  <label>
                    <span className="hub-field-label">{BUG_REPORT_COPY.pathLabel}</span>
                    <input value={pagePath} readOnly disabled />
                  </label>
                ) : null}
              </div>
              <button type="submit" className="btn-primary btn-sm" disabled={busy || !boardOpen}>
                {busy ? BUG_REPORT_COPY.sending : BUG_REPORT_COPY.send}
              </button>
              {error ? <div className="error">{error}</div> : null}
            </form>
          )}

          <p className="hub-toolbar auth-panel-back-desktop">
            <Link className="btn-ghost btn-sm" to={pagePath || "/projections/weekly"}>
              {BUG_REPORT_COPY.back}
            </Link>
          </p>
        </div>
        <p className="app-studio-credit">
          {PRODUCT_NAME} · {STUDIO_NAME}
        </p>
      </div>
    </StandalonePageShell>
  );
}

function reportNext(pagePath) {
  return pagePath ? `/report?from=${encodeURIComponent(pagePath)}` : "/report";
}
