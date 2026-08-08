import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";

const STORY_BUTTONS = [
  { id: "cut", label: "Cut / released" },
  { id: "draft_win", label: "Won at auction" },
  { id: "trade", label: "Traded" },
  { id: "post_draft_fa", label: "FA lottery" },
];

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return `$${Number(v).toFixed(0)}`;
}

function salaryDisplay(story) {
  if (story.salary_label) return story.salary_label;
  return fmtSal(story.salary);
}

function playerStoryText(story) {
  const from = story.from_owner || "previous team";
  const to = story.to_owner || "new team";
  return `${story.player_name} moved from ${from} to ${to}`;
}

async function resolveStory(leagueId, movementIds, story) {
  const res = await apiFetch(
    `/api/hub/league/${leagueId}/contract-history/movements/bulk-resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movement_ids: movementIds, story }),
    },
  );
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

function PlayerStoryRow({ story, leagueId, onResolved }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const apply = async (storyId) => {
    setBusy(storyId);
    setErr("");
    try {
      const payload = await resolveStory(leagueId, story.movement_ids, storyId);
      onResolved(payload);
    } catch (e) {
      setErr(connectionErrorMessage(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <li className="hub-owner-change-row">
      <div className="hub-owner-change-row-head">
        <strong>{story.player_name}</strong>
        <span className="table-meta">
          {story.from_owner ? `${story.from_owner} → ${story.to_owner || "?"}` : story.to_owner}
          {salaryDisplay(story) ? ` · ${salaryDisplay(story)}` : ""}
        </span>
      </div>
      <p className="hub-owner-change-hint">{playerStoryText(story)}</p>
      {story.sleeper_hint && (
        <p className="hub-owner-change-sleeper chart-note">
          Sleeper: {story.sleeper_hint.label || story.sleeper_hint.story}
          {story.sleeper_hint.event_at ? ` (${String(story.sleeper_hint.event_at).slice(0, 10)})` : ""}
        </p>
      )}
      <div className="hub-owner-change-actions">
        {story.sleeper_hint && (
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!!busy}
            onClick={() => apply(story.sleeper_hint.story === "post_draft_fa" ? "post_draft_fa" : story.sleeper_hint.story)}
          >
            {busy === story.sleeper_hint.story ? "Saving…" : "Use Sleeper match"}
          </button>
        )}
        {STORY_BUTTONS.map((btn) => (
          <button
            key={btn.id}
            type="button"
            className="btn-ghost btn-sm"
            disabled={!!busy}
            onClick={() => apply(btn.id)}
          >
            {busy === btn.id ? "Saving…" : btn.label}
          </button>
        ))}
      </div>
      {err && <p className="error-banner">{err}</p>}
    </li>
  );
}

function BulkDepartureCard({ group, leagueId, onResolved }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const apply = async (storyId) => {
    setBusy(storyId);
    setErr("");
    try {
      const payload = await resolveStory(leagueId, group.movement_ids, storyId);
      onResolved(payload);
    } catch (e) {
      setErr(connectionErrorMessage(e));
    } finally {
      setBusy("");
    }
  };

  const preview = (group.players || []).slice(0, 5).join(", ");
  const extra = (group.players || []).length > 5 ? ` +${group.players.length - 5} more` : "";

  return (
    <div className="hub-owner-change-bulk panel">
      <h5 className="hub-owner-change-bulk-title">
        {group.player_count} players left {group.from_owner}
      </h5>
      <p className="chart-note hub-section-hint">
        Common when an owner rebuilds — usually cuts, not trades. Applies to: {preview}{extra}
      </p>
      <div className="hub-owner-change-actions">
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={!!busy}
          onClick={() => apply("cut")}
        >
          {busy === "cut" ? "Saving…" : "Mark all as cuts"}
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={!!busy}
          onClick={() => apply("draft_win")}
        >
          {busy === "draft_win" ? "Saving…" : "Others won at auction"}
        </button>
      </div>
      {err && <p className="error-banner">{err}</p>}
    </div>
  );
}

function playerKey(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function ContractOwnerChangesPanel({
  ownerChanges,
  season,
  leagueId,
  isCommissioner,
  onResolved,
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [hintMap, setHintMap] = useState({});
  const [hintsLoading, setHintsLoading] = useState(false);

  const playerStories = ownerChanges?.player_stories || [];
  const bulkGroups = ownerChanges?.bulk_departures || [];
  const resolvedPreview = ownerChanges?.resolved_preview || [];
  const ambiguousCount = ownerChanges?.ambiguous_count || 0;

  useEffect(() => {
    if (!leagueId || !season || ambiguousCount === 0) {
      setHintMap({});
      return;
    }
    let cancelled = false;
    setHintsLoading(true);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/hub/league/${leagueId}/contract-history/sleeper-hints?season=${encodeURIComponent(season)}`,
        );
        if (!res.ok) return;
        const payload = await res.json();
        if (!cancelled) setHintMap(payload.hints_by_player || {});
      } catch {
        if (!cancelled) setHintMap({});
      } finally {
        if (!cancelled) setHintsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId, season, ambiguousCount]);

  const playerStoriesWithHints = useMemo(
    () => playerStories.map((s) => ({
      ...s,
      sleeper_hint: s.sleeper_hint || hintMap[playerKey(s.player_name)] || null,
    })),
    [playerStories, hintMap],
  );

  const bulkIds = useMemo(
    () => new Set((bulkGroups || []).flatMap((g) => g.movement_ids || [])),
    [bulkGroups],
  );

  const standaloneStories = useMemo(
    () => playerStoriesWithHints.filter((s) => !(s.movement_ids || []).some((id) => bulkIds.has(id))),
    [playerStoriesWithHints, bulkIds],
  );

  if (!season || ambiguousCount === 0) {
    if (resolvedPreview.length > 0) {
      return (
        <details className="hub-owner-changes-resolved">
          <summary>
            Resolved owner changes ({ownerChanges.resolved_count || resolvedPreview.length})
          </summary>
          <ul className="hub-insights-timeline">
            {resolvedPreview.map((m) => (
              <li key={m.id}>
                <strong>{m.player_name}</strong>
                {" — "}
                {m.event_type}
                {m.from_owner ? ` from ${m.from_owner}` : ""}
                {m.to_owner ? ` → ${m.to_owner}` : ""}
              </li>
            ))}
          </ul>
        </details>
      );
    }
    return null;
  }

  if (!isCommissioner) {
    return (
      <section className="hub-live-section">
        <h4 className="hub-live-section-title">Owner changes ({ambiguousCount} unclear)</h4>
        <p className="chart-note">The commissioner needs to confirm how these players changed teams.</p>
      </section>
    );
  }

  return (
    <section className="hub-live-section hub-owner-changes">
      <h4 className="hub-live-section-title">
        Who changed teams for {season}?
      </h4>
      <p className="chart-note hub-section-hint">
        Compared {Number(season) - 1} → {season} cap sheets. Most leftovers are FA lottery
        (on the year sheet, not draft/trade). Sleeper trades may be from the prior season.
        FA contracts are always $1 and expire before the next draft (not keepers).
        In-season $1 waivers are not retained on Historic sheets.
        {hintsLoading && " Loading Sleeper hints…"}
      </p>

      {bulkGroups.length > 0 && (
        <div className="hub-owner-change-bulk-list">
          {bulkGroups.map((g) => (
            <BulkDepartureCard
              key={g.from_owner}
              group={g}
              leagueId={leagueId}
              onResolved={onResolved}
            />
          ))}
        </div>
      )}

      {standaloneStories.length > 0 && (
        <>
          <h5 className="hub-owner-change-subtitle">Individual players</h5>
          <ul className="hub-owner-change-list">
            {standaloneStories.map((s) => (
              <PlayerStoryRow
                key={s.movement_ids.join("-")}
                story={s}
                leagueId={leagueId}
                onResolved={onResolved}
              />
            ))}
          </ul>
        </>
      )}

      {resolvedPreview.length > 0 && (
        <details
          className="hub-owner-changes-resolved"
          open={showResolved}
          onToggle={(e) => setShowResolved(e.target.open)}
        >
          <summary>
            Already resolved ({ownerChanges.resolved_count || resolvedPreview.length})
          </summary>
          <ul className="hub-insights-timeline">
            {resolvedPreview.map((m) => (
              <li key={m.id}>
                <strong>{m.player_name}</strong>
                {" — "}
                {m.event_type}
                {m.from_owner ? ` from ${m.from_owner}` : ""}
                {m.to_owner ? ` → ${m.to_owner}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
