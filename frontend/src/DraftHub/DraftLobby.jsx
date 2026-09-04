import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import Button from "../ui/Button";
import {
  DRAFT_TZ_OPTIONS,
  draftFormatLabel,
  formatDraftScheduleLabel,
  formatDraftWait,
  isPickDraft,
  utcIsoToWall,
} from "./draftEntryStatus";
import { availabilityTimezone, calendarTodayIso, slotToWall, wallToSlot } from "./draftAvailabilityPresentation";
import { altLockSummary, lobbyAbsoluteUrl, lobbyChipLabel, roomHeading, roomSupport, slotLabel } from "./draftLobby";
import {
  draftInviteLabel,
  draftInviteRailHint,
  draftInviteWhatHappens,
  draftLobbyHeroHeading,
  draftLobbyHeroSupport,
  draftLobbyRailHeading,
  draftLobbyReadiness,
  emailManagersHint,
  managerClaimCopied,
  managerClaimCopyTextLabel,
  managerClaimExplainer,
  managerClaimLabel,
  managerClaimRotateHint,
  managerClaimTextBody,
  managerClaimTextCopied,
  managerClaimWhatHappens,
  shareableAppUrl,
} from "./leagueAccessCopy";
import DraftAvailability from "./DraftAvailability";
import DraftNightSchedule from "./DraftNightSchedule";
import { HubExperienceHero, HubExperienceLayout, HubExperienceSummary } from "./HubUILayout";
import { secondsUntil } from "./draftRoomHelpers";
import { fmtSal } from "./rosterFormat";

export default function DraftLobby({
  busy = false,
  league = null,
  leagueId = "",
  rules = null,
  teams = [],
  viewer = null,
  isCommissioner = false,
  testMode = false,
  roomLoading = false,
  claimedHumans = 0,
  onStartDraft,
  onSaveSchedule,
  onUpdated,
  guestMode = false,
  claimAccess = null,
}) {
  const [copied, setCopied] = useState(false);
  const [claimCopied, setClaimCopied] = useState(false);
  const [claimTextCopied, setClaimTextCopied] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimLink, setClaimLink] = useState(claimAccess?.url || "");
  const [slotBusy, setSlotBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [fillBots, setFillBots] = useState(true);
  const [notifyState, setNotifyState] = useState("");
  const [error, setError] = useState("");

  const pickDraft = isPickDraft(rules || league?.rules);
  const draftType = String((rules || league?.rules)?.draft_type || "auction").toLowerCase();
  const formatLabel = draftFormatLabel(rules || league?.rules);
  const teamCount = Number(league?.team_count || 12);
  const roomCode = String(league?.room_code || "").toUpperCase();
  const inviteUrl = roomCode ? lobbyAbsoluteUrl(roomCode) : "";
  const claimUrl = shareableAppUrl(claimLink || claimAccess?.url || "");
  const claimEnabled = claimAccess?.enabled !== false;
  const myTeamId = viewer?.team_id;
  const mySlot = (teams || []).find((t) => String(t.id) === String(myTeamId))?.draft_slot;
  const humans = useMemo(
    () => (teams || []).filter((t) => !t.is_bot),
    [teams],
  );
  const claimed = claimedHumans || humans.filter((t) => t.user_sub).length;
  const budget = Number((rules || league?.rules)?.salary_cap ?? 200);

  const tzDefault = availabilityTimezone(league?.draft_timezone);
  const [draftTz, setDraftTz] = useState(tzDefault);
  const [draftWall, setDraftWall] = useState(() => utcIsoToWall(league?.draft_starts_at, tzDefault));
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [bestOverlap, setBestOverlap] = useState("");
  const onAvailHighlight = useCallback((label) => setBestOverlap(label || ""), []);
  const startsAt = league?.draft_starts_at;
  const lockedSlot = useMemo(
    () => (startsAt ? wallToSlot(utcIsoToWall(startsAt, draftTz)) : null),
    [draftTz, startsAt],
  );

  useEffect(() => {
    const tz = availabilityTimezone(league?.draft_timezone);
    setDraftTz(tz);
    setDraftWall(utcIsoToWall(league?.draft_starts_at, tz));
  }, [league?.draft_starts_at, league?.draft_timezone]);
  const waitSecs = startsAt ? secondsUntil(startsAt) : null;
  const scheduledLabel = startsAt ? formatDraftScheduleLabel(startsAt, draftTz) : "";
  const tzOptions = DRAFT_TZ_OPTIONS.includes(draftTz) ? DRAFT_TZ_OPTIONS : [draftTz, ...DRAFT_TZ_OPTIONS];
  const readiness = draftLobbyReadiness({
    claimed,
    teamCount,
    scheduled: Boolean(startsAt),
    testMode,
  });

  const slots = useMemo(() => {
    const bySlot = new Map();
    humans.forEach((team) => {
      const slot = Number(team.draft_slot);
      if (Number.isFinite(slot) && slot > 0 && !bySlot.has(slot)) bySlot.set(slot, team);
    });
    return Array.from({ length: teamCount }, (_, i) => {
      const slot = i + 1;
      return { slot, team: bySlot.get(slot) || null };
    });
  }, [humans, teamCount]);

  const copyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the link. Select it and copy manually.");
    }
  };

  const copyClaimLink = async () => {
    if (!claimUrl) return;
    try {
      await navigator.clipboard.writeText(claimUrl);
      setClaimCopied(true);
      setClaimTextCopied(false);
      window.setTimeout(() => setClaimCopied(false), 2200);
    } catch {
      setError("Could not copy the invite link. Select it and copy manually.");
    }
  };

  const copyClaimText = async () => {
    const body = managerClaimTextBody({ leagueName: league?.name, url: claimUrl });
    if (!claimUrl) return;
    try {
      await navigator.clipboard.writeText(body);
      setClaimTextCopied(true);
      setClaimCopied(false);
      window.setTimeout(() => setClaimTextCopied(false), 2200);
    } catch {
      setError("Could not copy the invite text. Select the link and send it yourself.");
    }
  };

  const rotateClaimLink = async () => {
    if (!leagueId || claimBusy) return;
    setClaimBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/claim-link/rotate`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setClaimLink(data.claim?.url || "");
      onUpdated?.(data);
    } catch (e) {
      setError(e.message || "Could not rotate the invite link");
    } finally {
      setClaimBusy(false);
    }
  };

  const claimSlot = async (slot) => {
    if (!leagueId || slotBusy) return;
    const next = Number(mySlot) === Number(slot) ? null : slot;
    setSlotBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/lobby/slot`, {
        method: "POST",
        body: JSON.stringify({ slot: next }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onUpdated?.(await res.json());
    } catch (e) {
      setError(e.message || "Could not claim that pick");
    } finally {
      setSlotBusy(false);
    }
  };

  const saveName = async () => {
    if (!leagueId) return;
    setSlotBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/lobby/name`, {
        method: "POST",
        body: JSON.stringify({ name: nameDraft }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onUpdated?.(await res.json());
      setNameOpen(false);
    } catch (e) {
      setError(e.message || "Could not update name");
    } finally {
      setSlotBusy(false);
    }
  };

  const notifyManagers = async () => {
    if (!leagueId) return;
    setSlotBusy(true);
    setError("");
    setNotifyState("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/lobby/notify?force=true`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (!data.recipients) {
        setNotifyState("No manager emails on file. Share the link instead.");
      } else if (data.sent) {
        setNotifyState(`Emailed ${data.sent} manager${data.sent === 1 ? "" : "s"}.`);
      } else {
        setNotifyState("Email is not configured on this server. Share the link instead.");
      }
    } catch (e) {
      setError(e.message || "Could not email managers");
    } finally {
      setSlotBusy(false);
    }
  };

  const saveSchedule = async (clear = false, override = null) => {
    if (!onSaveSchedule) return;
    setScheduleBusy(true);
    try {
      if (clear) {
        await onSaveSchedule({ clear: true });
        return;
      }
      const wall = override?.wall || draftWall;
      const timezone = override?.timezone || draftTz;
      await onSaveSchedule({ wall, timezone });
    } finally {
      setScheduleBusy(false);
    }
  };

  const lockAvailabilitySlot = async (slot) => {
    const wall = slotToWall(slot?.date, slot?.hour);
    if (!wall) return;
    const timezone = availabilityTimezone(league?.draft_timezone);
    setDraftWall(wall);
    setDraftTz(timezone);
    await saveSchedule(false, { wall, timezone });
  };

  const heading = draftLobbyHeroHeading({ testMode });
  const support = draftLobbyHeroSupport({ testMode });

  return (
    <div className="draft-lobby hub-experience-stack">
      <HubExperienceHero
        eyebrow={testMode ? "Mock lobby" : "Draft lobby"}
        heading={heading}
        support={support}
        chip={lobbyChipLabel({ claimed, teamCount })}
        chipTone={claimed > 0 ? "active" : "readonly"}
      />

      {error ? <p className="hub-alert hub-alert--danger draft-lobby-error" role="alert">{error}</p> : null}

      <HubExperienceLayout
        summaryLabel="Draft setup"
        summary={(
          <HubExperienceSummary
            eyebrow="Draft setup"
            title={league?.name || "Draft room"}
            subtitle={formatLabel}
            items={[
              {
                id: "night",
                label: startsAt ? "Locked night" : "Draft night",
                value: scheduledLabel
                  ? (waitSecs != null && waitSecs > 0
                    ? `${scheduledLabel} · ${formatDraftWait(waitSecs)}`
                    : scheduledLabel)
                  : "When you start",
              },
              ...(bestOverlap ? [{ id: "overlap", label: "Best overlap", value: bestOverlap }] : []),
              { id: "format", label: "Format", value: formatLabel },
              ...(!pickDraft ? [{ id: "budget", label: "Salary cap", value: fmtSal(budget) }] : []),
              { id: "seated", label: "Seated", value: `${claimed} / ${teamCount}` },
              ...(mySlot ? [{ id: "position", label: slotLabel(draftType), value: `#${mySlot}` }] : []),
            ]}
            action={(
              <div className="draft-lobby-rail-actions">
                <section className="draft-lobby-readiness" aria-labelledby="draft-lobby-ready-heading">
                  <h4 id="draft-lobby-ready-heading">
                    {draftLobbyRailHeading({ isCommissioner, testMode })}
                  </h4>
                  <ul>
                    {readiness.map((item) => (
                      <li key={item.id} className={`is-${item.tone}`}>{item.label}</li>
                    ))}
                  </ul>
                </section>
                {isCommissioner && testMode ? (
                  <label className="hub-toggle-row hub-toggle-row-compact">
                    <input
                      type="checkbox"
                      checked={fillBots}
                      onChange={(e) => setFillBots(e.target.checked)}
                      disabled={busy}
                    />
                    <span>Fill leftovers with bots</span>
                  </label>
                ) : null}
                {isCommissioner ? (
                  <Button
                    className="draft-lobby-primary-action"
                    disabled={busy || roomLoading}
                    onClick={() => onStartDraft?.({ fillBots: testMode && fillBots })}
                  >
                    {busy ? "Starting…" : (testMode ? "Start mock draft" : "Start live draft")}
                  </Button>
                ) : (
                  <p className="hub-experience-summary-note">Waiting for the commissioner to start.</p>
                )}
                {isCommissioner && !testMode && claimUrl ? (
                  <div className="draft-lobby-link draft-lobby-claim">
                    <label htmlFor="draft-claim-url">{managerClaimLabel()}</label>
                    <div className="draft-lobby-link-row">
                      <input id="draft-claim-url" readOnly value={claimUrl} />
                      <Button variant="ghost" size="sm" onClick={copyClaimLink}>
                        {claimCopied ? "Copied" : "Copy"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={copyClaimText}>
                        {managerClaimCopyTextLabel({ copied: claimTextCopied })}
                      </Button>
                    </div>
                    {claimCopied ? <p className="hub-experience-summary-note">{managerClaimCopied()}</p> : null}
                    {claimTextCopied ? <p className="hub-experience-summary-note">{managerClaimTextCopied()}</p> : null}
                    {!claimEnabled ? (
                      <p className="chart-note">This link is turned off in Roster management.</p>
                    ) : null}
                    <details className="draft-lobby-invite-details">
                      <summary>How claiming works</summary>
                      <p className="chart-note">{managerClaimExplainer()}</p>
                      <p className="chart-note">{managerClaimWhatHappens()}</p>
                      <button
                        type="button"
                        className="btn-link"
                        disabled={claimBusy}
                        onClick={rotateClaimLink}
                      >
                        {claimBusy ? "Rotating…" : "Rotate link"}
                      </button>
                      <p className="chart-note">{managerClaimRotateHint()}</p>
                    </details>
                  </div>
                ) : null}
                {inviteUrl ? (
                  <div className="draft-lobby-link">
                    <label htmlFor="draft-lobby-url">{draftInviteLabel({ testMode })}</label>
                    <div className="draft-lobby-link-row">
                      <input id="draft-lobby-url" readOnly value={inviteUrl} />
                      <Button variant="ghost" size="sm" onClick={copyLink}>
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <details className="draft-lobby-invite-details">
                      <summary>How draft-night access works</summary>
                      <p className="chart-note">{draftInviteRailHint({ testMode })}</p>
                      <p className="chart-note">{draftInviteWhatHappens({ testMode })}</p>
                      {isCommissioner && !testMode ? (
                        <p className="chart-note">{emailManagersHint()}</p>
                      ) : null}
                    </details>
                  </div>
                ) : null}
                {isCommissioner && !testMode ? (
                  <Button variant="ghost" disabled={slotBusy || busy} onClick={notifyManagers}>
                    Email managers already in the league
                  </Button>
                ) : null}
                {notifyState ? <p className="hub-experience-summary-note">{notifyState}</p> : null}
              </div>
            )}
          />
        )}
      >
        {!testMode && viewer?.team_id ? (
          <DraftAvailability
            leagueId={leagueId}
            enabled={!guestMode}
            canLock={isCommissioner && Boolean(onSaveSchedule)}
            lockedSlot={lockedSlot}
            lockBusy={scheduleBusy || busy}
            onHighlight={onAvailHighlight}
            onLockSlot={lockAvailabilitySlot}
          />
        ) : null}

        {isCommissioner && !testMode && onSaveSchedule ? (
          <details className="draft-lobby-alt-lock">
            <summary>{altLockSummary({ locked: Boolean(startsAt) })}</summary>
            <DraftNightSchedule
              variant="compact"
              startsAt={startsAt}
              timezone={draftTz}
              wall={draftWall}
              onWallChange={setDraftWall}
              onTimezoneChange={setDraftTz}
              tzOptions={tzOptions}
              canEdit
              busy={scheduleBusy || busy}
              waitSecs={waitSecs}
              minDate={calendarTodayIso(undefined, draftTz)}
              onSave={() => saveSchedule(false)}
              onClear={() => saveSchedule(true)}
            />
          </details>
        ) : null}

        <article className="hub-experience-section draft-lobby-room">
          <header className="hub-draft-entry-card-head">
            <h3>{roomHeading()}</h3>
            <p className="chart-note">{roomSupport({ guestMode, testMode })}</p>
          </header>
          <ol className="hub-pick-grid draft-lobby-slots" aria-label={slotLabel(draftType)}>
            {slots.map(({ slot, team }) => {
              const mine = team && String(team.id) === String(myTeamId);
              const taken = Boolean(team) && !mine;
              return (
                <li key={slot}>
                  <button
                    type="button"
                    className={`hub-pick-tile draft-lobby-slot${mine ? " is-you" : ""}${taken ? " is-taken" : ""}${!team ? " is-open" : ""}`}
                    disabled={slotBusy || busy || taken || !myTeamId}
                    aria-pressed={Boolean(mine)}
                    onClick={() => claimSlot(slot)}
                  >
                    <span className="draft-lobby-slot-num">{slot}</span>
                    <span className="draft-lobby-slot-who">{team?.name || "Open"}</span>
                    <span className="draft-lobby-slot-action">
                      {mine ? "Yours" : taken ? "Taken" : "Take"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {myTeamId ? (
            <div className="draft-lobby-rename">
              {nameOpen ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveName();
                  }}
                >
                  <label htmlFor="draft-lobby-name">Your name in this room</label>
                  <div className="draft-lobby-link-row">
                    <input
                      id="draft-lobby-name"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      maxLength={24}
                      autoFocus
                    />
                    <Button type="submit" size="sm" disabled={slotBusy || !nameDraft.trim()}>Save</Button>
                    <Button variant="ghost" size="sm" type="button" onClick={() => setNameOpen(false)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    setNameDraft(viewer?.team_name || "");
                    setNameOpen(true);
                  }}
                >
                  Change your name
                </button>
              )}
            </div>
          ) : null}
        </article>

      </HubExperienceLayout>
    </div>
  );
}
