import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";

const DEFAULT_OWNERS = [
  "Aaron D",
  "Andrew M",
  "Caleb K",
  "Chris G",
  "Colby L",
  "Dawson O",
  "Josh C",
  "Justin P",
  "Nick F",
  "Stephen P",
];

export default function OwnerSeasonMapPanel({
  leagueId,
  season,
  rows = [],
  isCommissioner,
  onUpdated,
}) {
  const mobileLayout = useMobileLayout();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const seasonInt = season ? Number(season) : null;

  const ownerRows = useMemo(() => {
    const byOwner = Object.fromEntries((rows || []).map((r) => [r.owner_label, r]));
    const owners = [...new Set([...DEFAULT_OWNERS, ...Object.keys(byOwner)])].sort();
    return owners.map((owner) => ({
      owner_label: owner,
      hub_team_name: draft[owner] ?? byOwner[owner]?.hub_team_name ?? "",
      id: byOwner[owner]?.id,
      source_kind: byOwner[owner]?.source_kind,
    }));
  }, [rows, draft]);

  useEffect(() => {
    setDraft({});
    setError("");
  }, [season, leagueId]);

  const saveOwner = useCallback(
    async (ownerLabel, hubTeamName) => {
      if (!leagueId || !seasonInt || !hubTeamName.trim()) return;
      setSaving(ownerLabel);
      setError("");
      try {
        const res = await apiFetch(`/api/hub/league/${leagueId}/owner-season-map`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            season_year: seasonInt,
            owner_label: ownerLabel,
            hub_team_name: hubTeamName.trim(),
          }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        setDraft((prev) => {
          const next = { ...prev };
          delete next[ownerLabel];
          return next;
        });
        onUpdated?.();
      } catch (e) {
        setError(connectionErrorMessage(e));
      } finally {
        setSaving("");
      }
    },
    [leagueId, seasonInt, onUpdated],
  );

  if (!isCommissioner || !seasonInt) return null;

  return (
    <section className="hub-contract-owner-map panel">
      <h4 className="hub-live-section-title">Owner → team names ({season})</h4>
      <p className="chart-note">
        Team names as they appeared that season (for cap history and Insights).
      </p>
      {error && <p className="error-banner">{error}</p>}
      {mobileLayout ? (
        <div className="hub-live-starter-grid">
          {ownerRows.map((r) => (
            <div key={r.owner_label} className="hub-contract-owner-map-row">
              <label>
                <span className="hub-filter-label">{r.owner_label}</span>
                <input
                  className="search-input"
                  value={draft[r.owner_label] ?? r.hub_team_name}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.owner_label]: e.target.value }))}
                  placeholder="Hub / Sleeper team name"
                />
              </label>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={saving === r.owner_label}
                onClick={() => saveOwner(r.owner_label, draft[r.owner_label] ?? r.hub_team_name)}
              >
                {saving === r.owner_label ? "Saving…" : "Save"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table compact hub-contract-table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Team name</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ownerRows.map((r) => (
                <tr key={r.owner_label}>
                  <td>{r.owner_label}</td>
                  <td>
                    <input
                      className="search-input"
                      value={draft[r.owner_label] ?? r.hub_team_name}
                      onChange={(e) => setDraft((d) => ({ ...d, [r.owner_label]: e.target.value }))}
                      placeholder="Hub / Sleeper team name"
                    />
                  </td>
                  <td className="table-meta">{r.source_kind || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={saving === r.owner_label}
                      onClick={() => saveOwner(r.owner_label, draft[r.owner_label] ?? r.hub_team_name)}
                    >
                      {saving === r.owner_label ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
