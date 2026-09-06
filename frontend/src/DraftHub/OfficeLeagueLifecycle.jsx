import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { HubAlert, HubLoadingSkeleton } from "./HubUILayout";
import {
  LEAGUE_DELETE_COPY,
  LEAGUE_WORKBOOK_COPY,
  leagueDeletePendingLine,
  leagueNameMatches,
} from "./leagueAccessCopy";
import { downloadLeagueWorkbook } from "./leagueWorkbook";

export default function OfficeLeagueLifecycle({
  leagueId,
  leagueName,
  onChanged,
  onNavigate,
}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/delete-request`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setStatus(await res.json());
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [load]);

  const officialName = status?.league_name || leagueName || "";
  const nameReady = leagueNameMatches(typed, officialName);
  const pending = Boolean(status?.pending);

  const pendingLine = useMemo(() => {
    if (!pending) return "";
    return leagueDeletePendingLine({
      approved: status?.approved_count,
      required: status?.required_count,
      waiting: status?.waiting_names,
    });
  }, [pending, status]);

  async function handleExport() {
    setBusy("export");
    setError("");
    try {
      await downloadLeagueWorkbook(leagueId);
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function postDelete(path, { method = "POST", body } = {}) {
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  }

  async function handleStart() {
    if (!nameReady) return;
    setBusy("start");
    setError("");
    try {
      await downloadLeagueWorkbook(leagueId);
      const data = await postDelete("/delete-request", {
        body: { confirm_name: typed },
      });
      await afterWrite(data);
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function handleApprove() {
    if (!nameReady) return;
    setBusy("approve");
    setError("");
    try {
      await downloadLeagueWorkbook(leagueId);
      const data = await postDelete("/delete-request/approve", {
        body: { confirm_name: typed },
      });
      await afterWrite(data);
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function handleCancel() {
    setBusy("cancel");
    setError("");
    try {
      const data = await postDelete("/delete-request/cancel");
      setTyped("");
      setStatus(data);
      onChanged?.();
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function afterWrite(data) {
    if (data?.deleted) {
      onChanged?.();
      onNavigate?.("home");
      return;
    }
    setTyped("");
    setStatus(data);
    onChanged?.();
  }

  const confirmId = "hub-league-delete-confirm";
  const exporting = busy === "export";
  const starting = busy === "start";
  const approving = busy === "approve";

  return (
    <>
      <section className="hub-office-access-section">
        <header className="hub-section-head">
          <h3 className="hub-section-title">{LEAGUE_WORKBOOK_COPY.title}</h3>
          <p className="hub-section-hint">{LEAGUE_WORKBOOK_COPY.exportSupport}</p>
        </header>
        <div className="hub-league-lifecycle-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={handleExport}
            disabled={Boolean(busy)}
          >
            {exporting ? LEAGUE_WORKBOOK_COPY.exportBusy : LEAGUE_WORKBOOK_COPY.exportLabel}
          </button>
        </div>
      </section>

      <section className="hub-office-access-section hub-league-lifecycle">
        <header className="hub-section-head">
          <h3 className="hub-section-title">{LEAGUE_DELETE_COPY.title}</h3>
          <p className="hub-section-hint">{LEAGUE_DELETE_COPY.support}</p>
        </header>
        {error ? <HubAlert variant="danger">{error}</HubAlert> : null}
        {loading && !status ? (
          <HubLoadingSkeleton label="Checking delete status" rows={1} />
        ) : null}
        {pending && pendingLine ? (
          <p className="hub-league-lifecycle-pending" role="status">
            {pendingLine}
          </p>
        ) : null}
        {status?.you_approved ? (
          <p className="hub-league-lifecycle-pending">{LEAGUE_DELETE_COPY.youAgreed}</p>
        ) : null}
        {status?.commissioners?.length ? (
          <ul className="hub-league-lifecycle-staff" aria-label={LEAGUE_DELETE_COPY.staffHeading}>
            {status.commissioners.map((row) => (
              <li key={row.user_sub}>
                <span>{row.owner_name}</span>
                <span className={row.approved ? "is-agreed" : "is-waiting"}>
                  {row.approved ? LEAGUE_DELETE_COPY.agreed : LEAGUE_DELETE_COPY.waiting}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="hub-league-lifecycle-confirm">
          <label htmlFor={confirmId}>
            <span>{LEAGUE_DELETE_COPY.confirmLabel}</span>
            <input
              id={confirmId}
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={officialName}
            />
          </label>
          {!nameReady ? (
            <p className="hub-section-hint" id={`${confirmId}-hint`}>
              {LEAGUE_DELETE_COPY.confirmHint}
            </p>
          ) : null}
        </div>
        <div className="hub-league-lifecycle-actions">
          {!pending ? (
            <button
              type="button"
              className="btn-danger"
              disabled={!nameReady || Boolean(busy)}
              aria-describedby={nameReady ? undefined : `${confirmId}-hint`}
              onClick={handleStart}
            >
              {starting ? LEAGUE_WORKBOOK_COPY.exportBusy : LEAGUE_DELETE_COPY.start}
            </button>
          ) : null}
          {pending && status?.can_approve ? (
            <button
              type="button"
              className="btn-danger"
              disabled={!nameReady || Boolean(busy)}
              aria-describedby={nameReady ? undefined : `${confirmId}-hint`}
              onClick={handleApprove}
            >
              {approving ? LEAGUE_WORKBOOK_COPY.exportBusy : LEAGUE_DELETE_COPY.approve}
            </button>
          ) : null}
          {pending && status?.can_cancel ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={Boolean(busy)}
              onClick={handleCancel}
            >
              {LEAGUE_DELETE_COPY.cancel}
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}
