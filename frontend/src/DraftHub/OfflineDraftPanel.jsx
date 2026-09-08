import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import Button from "../ui/Button";
import { HubFilterMenu } from "./HubUILayout";
import { OFFLINE_DRAFT_COPY } from "./leagueAccessCopy";
import { isPickDraft } from "./draftEntryStatus";
import {
  canRunOfflineCommissioner,
  canShowOwnerRecord,
  downloadDraftResultsCsv,
} from "./offlineDraft";

export function OfflineRecordDock({
  teams = [],
  teamId,
  onTeamChange,
  salary,
  onSalaryChange,
  pickDraft = false,
  showTeam = false,
}) {
  return (
    <div className="hub-draft-offline-dock">
      {showTeam ? (
        <HubFilterMenu
          label={OFFLINE_DRAFT_COPY.teamLabel}
          value={teamId}
          options={(teams || []).map((t) => ({
            id: String(t.id),
            label: t.owner_name ? `${t.owner_name} · ${t.name}` : t.name,
          }))}
          onChange={onTeamChange}
        />
      ) : null}
      {!pickDraft ? (
        <input
          inputMode="numeric"
          value={salary}
          onChange={(e) => onSalaryChange?.(e.target.value)}
          aria-label={OFFLINE_DRAFT_COPY.salaryLabel}
        />
      ) : null}
    </div>
  );
}

export default function OfflineDraftPanel({
  leagueId,
  session = null,
  teams = [],
  viewer = null,
  rules = null,
  isCommissioner = false,
  testMode = false,
  busy = false,
  hubContext = null,
  onStartOffline,
  onUpdated,
}) {
  const pickDraft = isPickDraft(rules);
  const ownerOpen = Boolean(session?.owner_entry_open);
  const myTeamId = viewer?.team_id || "";
  const runAsCommish = canRunOfflineCommissioner({ hubContext, isCommissioner });
  const showOwnerForm = canShowOwnerRecord({ session, hubContext, myTeamId });
  const seated = useMemo(
    () => (teams || []).filter((t) => t?.id && !t.is_bot),
    [teams],
  );

  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [teamId, setTeamId] = useState(myTeamId);
  const [salary, setSalary] = useState("1");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState("");
  const [localBusy, setLocalBusy] = useState("");

  useEffect(() => {
    if (myTeamId && !teamId) setTeamId(myTeamId);
  }, [myTeamId, teamId]);

  if (testMode || !leagueId) return null;
  if (!runAsCommish && !showOwnerForm) return null;

  const run = async (key, fn) => {
    setLocalBusy(key);
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg(e.message || "Could not save");
    } finally {
      setLocalBusy("");
    }
  };

  const recordWin = () => run("record", async () => {
    const dest = runAsCommish ? teamId : myTeamId;
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/draft/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_id: playerId.trim(),
        player_name: playerName.trim(),
        team_id: dest,
        salary: pickDraft ? undefined : Number(salary),
      }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    setPlayerId("");
    setPlayerName("");
    setMsg(OFFLINE_DRAFT_COPY.applied(1));
    onUpdated?.(await res.json());
  });

  const toggleEntry = (open) => run("entry", async () => {
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/draft/owner-entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    onUpdated?.(await res.json());
  });

  const previewCsv = () => run("preview", async () => {
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/draft/results/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv_text: csvText }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    setPreview(await res.json());
  });

  const applyCsv = () => run("apply", async () => {
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/draft/results/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv_text: csvText }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    setMsg(OFFLINE_DRAFT_COPY.applied(Number(data.applied) || 0));
    setPreview(null);
    onUpdated?.(data);
  });

  const downloadCsv = () => run("csv", async () => {
    await downloadDraftResultsCsv(leagueId, { apiFetch, parseApiError });
  });

  return (
    <article className="hub-experience-section draft-lobby-offline">
      <header className="hub-draft-entry-card-head">
        <h3>{OFFLINE_DRAFT_COPY.title}</h3>
        <p className="chart-note">{OFFLINE_DRAFT_COPY.hint}</p>
      </header>

      {runAsCommish ? (
        <div className="hub-toolbar">
          <Button
            variant="ghost"
            disabled={busy || Boolean(localBusy)}
            onClick={() => onStartOffline?.()}
          >
            {OFFLINE_DRAFT_COPY.startOffline}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || Boolean(localBusy)}
            onClick={() => toggleEntry(!ownerOpen)}
          >
            {ownerOpen ? OFFLINE_DRAFT_COPY.closeEntry : OFFLINE_DRAFT_COPY.openEntry}
          </Button>
          <Button variant="ghost" disabled={Boolean(localBusy)} onClick={downloadCsv}>
            {OFFLINE_DRAFT_COPY.exportCsv}
          </Button>
        </div>
      ) : null}
      <p className="chart-note">
        {runAsCommish
          ? (ownerOpen ? OFFLINE_DRAFT_COPY.entryOpen : OFFLINE_DRAFT_COPY.entryClosed)
          : OFFLINE_DRAFT_COPY.ownerHint}
      </p>

      {(runAsCommish || showOwnerForm) ? (
        <div className="hub-toolbar draft-lobby-offline-form">
          <label className="sr-only" htmlFor="offline-player-id">{OFFLINE_DRAFT_COPY.playerLabel}</label>
          <input
            id="offline-player-id"
            placeholder="Player id"
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
          />
          <input
            placeholder="or name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            aria-label={OFFLINE_DRAFT_COPY.playerLabel}
          />
          {runAsCommish ? (
            <HubFilterMenu
              label={OFFLINE_DRAFT_COPY.teamLabel}
              value={teamId}
              options={seated.map((t) => ({
                id: String(t.id),
                label: t.owner_name ? `${t.owner_name} · ${t.name}` : t.name,
              }))}
              onChange={setTeamId}
            />
          ) : null}
          {!pickDraft ? (
            <input
              inputMode="numeric"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              aria-label={OFFLINE_DRAFT_COPY.salaryLabel}
            />
          ) : null}
          <Button
            className="btn-primary btn-sm"
            disabled={Boolean(localBusy) || !(playerId.trim() || playerName.trim())}
            onClick={recordWin}
          >
            {OFFLINE_DRAFT_COPY.record}
          </Button>
        </div>
      ) : null}

      {runAsCommish ? (
        <details className="hub-pre-draft-details">
          <summary>{OFFLINE_DRAFT_COPY.csvHint}</summary>
          <textarea
            rows={5}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            aria-label="Draft results CSV"
          />
          <div className="hub-toolbar">
            <Button variant="ghost" disabled={!csvText.trim() || Boolean(localBusy)} onClick={previewCsv}>
              {OFFLINE_DRAFT_COPY.importCsv}
            </Button>
            {preview ? (
              <Button
                className="btn-primary btn-sm"
                disabled={!preview.ready_count || Boolean(localBusy)}
                onClick={applyCsv}
              >
                {OFFLINE_DRAFT_COPY.applyCsv}
              </Button>
            ) : null}
          </div>
          {preview ? (
            <p className="chart-note">
              {OFFLINE_DRAFT_COPY.previewReady(preview.ready_count)}
              {preview.error_count ? ` · ${OFFLINE_DRAFT_COPY.previewErrors(preview.error_count)}` : ""}
            </p>
          ) : null}
          {preview?.errors?.length ? (
            <ul className="draft-lobby-offline-errors">
              {preview.errors.slice(0, 4).map((row) => (
                <li key={`${row.row}-${row.player_id || row.name}`}>
                  {row.name || row.player_id || `Row ${row.row}`}: {row.error}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}

      {msg ? <p className="hub-msg" role="status">{msg}</p> : null}
    </article>
  );
}
