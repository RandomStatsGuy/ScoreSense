import React, { useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";

export default function DraftNominationQueue({
  leagueId,
  queue = [],
  autodraft = false,
  selectedPlayerId = "",
  selectedPlayerName = "",
  playerNames = {},
  disabled = false,
  pickDraft = false,
  onUpdated,
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (playerIds, nextAutodraft) => {
    if (!leagueId) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/nomination-queue`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_ids: playerIds,
          autodraft: nextAutodraft,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      onUpdated?.(data);
    } catch (e) {
      setError(e.message || "Could not save queue");
    } finally {
      setSaving(false);
    }
  };

  const addSelected = () => {
    const pid = String(selectedPlayerId || "");
    if (!pid || queue.includes(pid)) return;
    save([...queue, pid], autodraft);
  };

  const removeAt = (idx) => {
    save(queue.filter((_, i) => i !== idx), autodraft);
  };

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= queue.length) return;
    const next = [...queue];
    [next[idx], next[j]] = [next[j], next[idx]];
    save(next, autodraft);
  };

  return (
    <details className="hub-nom-queue">
      <summary>
        {pickDraft ? "Pick queue" : "Nomination queue"}
        <span className="chart-note">
          {" · "}
          {queue.length ? `${queue.length} queued` : "optional"}
          {autodraft ? " · autodraft on" : ""}
        </span>
      </summary>
      <p className="chart-note">
        {pickDraft
          ? "If you go AFK, the room picks from this list (then best available that fills a min)."
          : "If you go AFK, the room nominates from this list (then best available that fills a min)."}
      </p>
      <label className="hub-toggle-row hub-toggle-row-compact">
        <input
          type="checkbox"
          checked={Boolean(autodraft)}
          disabled={disabled || saving}
          onChange={(e) => save(queue, e.target.checked)}
        />
        <span>Autodraft when I&apos;m on the clock</span>
      </label>
      {queue.length > 0 && (
        <ol className="hub-nom-queue-list">
          {queue.map((pid, idx) => (
            <li key={`${pid}-${idx}`}>
              <span>{playerNames[pid] || pid}</span>
              <span className="hub-nom-queue-move">
                <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => move(idx, -1)}>
                  Up
                </button>
                <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => move(idx, 1)}>
                  Down
                </button>
                <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={() => removeAt(idx)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={disabled || saving || !selectedPlayerId || queue.includes(String(selectedPlayerId))}
        onClick={addSelected}
      >
        {selectedPlayerName ? `Queue ${selectedPlayerName}` : "Queue selected player"}
      </button>
      {error && <div className="error">{error}</div>}
    </details>
  );
}
