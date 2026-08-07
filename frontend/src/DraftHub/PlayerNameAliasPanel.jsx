import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";

function mapFormPosition(pos) {
  const p = String(pos || "").trim().toUpperCase();
  if (!p || p === "NAN" || p === "NONE" || p === "WC") return "";
  if (p === "DST" || p === "D") return "DEF";
  return p;
}

function priorTeamLabel(item) {
  if (!item?.prior_team_display && !item?.prior_owner_label) return "—";
  const label = item.prior_team_display || item.prior_owner_label;
  if (item.prior_season) return `${label} (${item.prior_season})`;
  return label;
}

function suggestionLabel(s) {
  const parts = [s.player_name];
  if (s.position) parts.push(s.position);
  if (s.team) parts.push(s.team);
  if (s.source === "sleeper") parts.push("Sleeper");
  else if (s.source) parts.push(s.source);
  return parts.join(" · ");
}

function PlayerNameMapForm({
  leagueId,
  season,
  initialAlias = "",
  initialPosition = "",
  initialCanonical = "",
  initialSleeperId = "",
  onSaved,
  onCancel,
}) {
  const [aliasName, setAliasName] = useState(initialAlias);
  const [sleeperName, setSleeperName] = useState(initialCanonical);
  const [sleeperPlayerId, setSleeperPlayerId] = useState(initialSleeperId);
  const [position, setPosition] = useState(initialPosition);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const suggestSeqRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const suggestSourceRef = useRef("alias");

  useEffect(() => {
    setAliasName(initialAlias);
    setSleeperName(initialCanonical);
    setSleeperPlayerId(initialSleeperId);
    setPosition(initialPosition);
    suggestSourceRef.current = initialCanonical ? "sleeper" : "alias";
  }, [initialAlias, initialCanonical, initialSleeperId, initialPosition]);

  const fetchSuggestions = useCallback(async (query, aliasFallback, seq) => {
    const q = query.trim();
    if (q.length < 2) {
      if (seq === suggestSeqRef.current) {
        setSuggestions([]);
        setSuggestLoading(false);
        setSuggestError("");
      }
      return;
    }
    if (seq === suggestSeqRef.current) {
      setSuggestLoading(true);
      setSuggestError("");
    }

    const runSearch = async (term, pos) => {
      const params = new URLSearchParams({ name: term });
      if (pos) params.set("position", pos);
      if (season) params.set("season", String(season));
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/player-name-aliases/suggest?${params}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) return null;
      const payload = await res.json();
      return payload.suggestions || [];
    };

    try {
      let list = await runSearch(q, position || null);
      if (seq !== suggestSeqRef.current) return;
      if (!list?.length && aliasFallback && aliasFallback !== q) {
        list = await runSearch(aliasFallback, position || null);
      }
      if (seq !== suggestSeqRef.current) return;
      if (!list?.length && position) {
        list = await runSearch(q, null);
        if (!list?.length && aliasFallback && aliasFallback !== q) {
          list = await runSearch(aliasFallback, null);
        }
      }
      if (seq !== suggestSeqRef.current) return;
      if (list == null) {
        setSuggestError("Could not search Sleeper — try again.");
        setSuggestions([]);
        return;
      }
      setSuggestions(list);
      if (!list.length) {
        setSuggestError(`No Sleeper matches for “${q}”. Try the cap-sheet name or a different spelling.`);
      }
    } catch (e) {
      if (seq !== suggestSeqRef.current) return;
      setSuggestions([]);
      setSuggestError(connectionErrorMessage(e, "Sleeper search timed out — is the API running?"));
    } finally {
      if (seq === suggestSeqRef.current) setSuggestLoading(false);
    }
  }, [leagueId, position, season]);

  useEffect(() => {
    const aliasQ = aliasName.trim();
    const sleeperQ = sleeperName.trim();
    const primary = suggestSourceRef.current === "sleeper" && sleeperQ.length >= 2
      ? sleeperQ
      : aliasQ;
    const fallback = primary === aliasQ ? sleeperQ : aliasQ;
    if (primary.length < 2) {
      setSuggestions([]);
      setSuggestLoading(false);
      setSuggestError("");
      return undefined;
    }
    const seq = ++suggestSeqRef.current;
    const timer = setTimeout(
      () => fetchSuggestions(primary, fallback.length >= 2 ? fallback : "", seq),
      450,
    );
    return () => clearTimeout(timer);
  }, [aliasName, sleeperName, position, fetchSuggestions]);

  const pickSuggestion = useCallback((s) => {
    setSleeperName(s.player_name);
    if (s.sleeper_player_id) setSleeperPlayerId(String(s.sleeper_player_id));
    if (s.position) setPosition(String(s.position).toUpperCase());
  }, []);

  const save = useCallback(async () => {
    if (!aliasName.trim()) return;
    if (!sleeperPlayerId && !sleeperName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        alias_name: aliasName.trim(),
      };
      const pos = String(position || "").trim().toUpperCase();
      if (pos) body.position = pos;
      if (sleeperPlayerId) body.sleeper_player_id = String(sleeperPlayerId);
      if (sleeperName.trim()) body.canonical_name = sleeperName.trim();
      const res = await apiFetch(`/api/hub/league/${leagueId}/player-name-aliases`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onSaved?.(await res.json());
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [aliasName, sleeperName, sleeperPlayerId, position, leagueId, onSaved]);

  return (
    <div className="hub-player-alias-form panel">
      <h4 className="hub-live-section-title">Map name</h4>
      <p className="chart-note">
        Link a cap-sheet abbreviation to a Sleeper player. You can map many aliases to the same player.
      </p>
      {error && <p className="error-banner">{error}</p>}
      <div className="hub-player-alias-fields">
        <label>
          <span className="hub-filter-label">As on cap sheet</span>
          <input
            className="search-input"
            value={aliasName}
            onChange={(e) => {
              suggestSourceRef.current = "alias";
              setAliasName(e.target.value);
            }}
            placeholder="Jeanty"
          />
        </label>
        <label>
          <span className="hub-filter-label">Sleeper player</span>
          <input
            className="search-input"
            value={sleeperName}
            onChange={(e) => {
              suggestSourceRef.current = "sleeper";
              setSleeperName(e.target.value);
              setSleeperPlayerId("");
            }}
            placeholder="Search Sleeper — Ashton Jeanty"
          />
        </label>
        <label>
          <span className="hub-filter-label">Position (optional)</span>
          <input
            className="search-input hub-salary-pos-pick"
            value={position}
            onChange={(e) => setPosition(e.target.value.toUpperCase())}
            placeholder="RB"
          />
        </label>
      </div>
      {sleeperPlayerId ? (
        <p className="table-meta hub-player-alias-linked">
          Linked to Sleeper id {sleeperPlayerId}
        </p>
      ) : null}
      {suggestLoading && <p className="table-meta">Searching Sleeper…</p>}
      {suggestError && !suggestLoading && <p className="error-banner">{suggestError}</p>}
      {suggestions.length > 0 && (
        <div className="hub-player-alias-suggest-list">
          <span className="hub-filter-label">Sleeper matches</span>
          <div className="hub-filter-scroll">
            {suggestions.map((s) => (
              <button
                key={`${s.sleeper_player_id || s.player_name}-${s.source}`}
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => pickSuggestion(s)}
              >
                {suggestionLabel(s)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="hub-player-alias-actions">
        <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save map"}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function groupAliasRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = row.sleeper_player_id
      ? `sid:${row.sleeper_player_id}`
      : `name:${row.canonical_name}`;
    const prev = groups.get(key) || {
      canonical_name: row.canonical_name,
      sleeper_player_id: row.sleeper_player_id,
      position: row.position,
      aliases: [],
    };
    prev.aliases.push(row);
    if (!prev.position && row.position) prev.position = row.position;
    if (row.position && mapFormPosition(row.position)) prev.position = mapFormPosition(row.position);
    groups.set(key, prev);
  }
  return [...groups.values()].sort((a, b) => (
    String(a.canonical_name || "").localeCompare(String(b.canonical_name || ""))
  ));
}

function AddBySleeperIdForm({ leagueId, onSaved }) {
  const [aliasName, setAliasName] = useState("");
  const [sleeperPlayerId, setSleeperPlayerId] = useState("");
  const [position, setPosition] = useState("");
  const [lookup, setLookup] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const runLookup = useCallback(async () => {
    const sid = sleeperPlayerId.trim();
    if (!sid) return;
    setLookupLoading(true);
    setError("");
    setLookup(null);
    try {
      const params = new URLSearchParams({ sleeper_player_id: sid });
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/player-name-aliases/suggest?${params}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      const match = payload.suggestions?.[0];
      if (!match) {
        setError("No Sleeper player for that id — use a numeric id (5846) or team code for DEF (BUF).");
        return;
      }
      setLookup(match);
      if (match.position) setPosition(String(match.position).toUpperCase());
    } catch (e) {
      setError(connectionErrorMessage(e, "Could not find that Sleeper id."));
    } finally {
      setLookupLoading(false);
    }
  }, [leagueId, sleeperPlayerId, position]);

  const save = useCallback(async () => {
    if (!aliasName.trim() || !sleeperPlayerId.trim()) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        alias_name: aliasName.trim(),
        sleeper_player_id: String(sleeperPlayerId.trim()),
      };
      if (position) body.position = position;
      if (lookup?.player_name) body.canonical_name = lookup.player_name;
      const res = await apiFetch(`/api/hub/league/${leagueId}/player-name-aliases`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const savedRow = await res.json();
      setAliasName("");
      setSleeperPlayerId("");
      setPosition("");
      setLookup(null);
      onSaved?.(savedRow);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [aliasName, sleeperPlayerId, position, lookup, leagueId, onSaved]);

  return (
    <div className="hub-player-alias-by-id panel">
      <h4 className="hub-live-section-title">Link by Sleeper id</h4>
      <p className="chart-note">
        For cap-sheet names not in the abbreviation scan — enter the name as it appears on your sheet and the Sleeper player id
        (numeric, e.g. 5846, or team code for defenses, e.g. BUF). Look up is optional; Save map resolves the id on the server.
      </p>
      {error && <p className="error-banner">{error}</p>}
      <div className="hub-player-alias-fields">
        <label>
          <span className="hub-filter-label">As on cap sheet</span>
          <input
            className="search-input"
            value={aliasName}
            onChange={(e) => setAliasName(e.target.value)}
            placeholder="DK Metcalf"
          />
        </label>
        <label>
          <span className="hub-filter-label">Sleeper id</span>
          <input
            className="search-input"
            value={sleeperPlayerId}
            onChange={(e) => {
              setSleeperPlayerId(e.target.value);
              setLookup(null);
            }}
            placeholder="5846 or BUF"
          />
        </label>
        <label>
          <span className="hub-filter-label">Position (optional)</span>
          <input
            className="search-input hub-salary-pos-pick"
            value={position}
            onChange={(e) => setPosition(e.target.value.toUpperCase())}
            placeholder="WR"
          />
        </label>
      </div>
      {lookup ? (
        <p className="table-meta hub-player-alias-linked">
          {lookup.player_name}
          {lookup.position ? ` · ${lookup.position}` : ""}
          {lookup.team ? ` · ${lookup.team}` : ""}
        </p>
      ) : null}
      <div className="hub-player-alias-actions">
        <button
          type="button"
          className="btn-ghost btn-sm"
          disabled={lookupLoading || !sleeperPlayerId.trim()}
          onClick={runLookup}
        >
          {lookupLoading ? "Looking up…" : "Look up"}
        </button>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={saving || !aliasName.trim() || !sleeperPlayerId.trim()}
          onClick={save}
        >
          {saving ? "Saving…" : "Save map"}
        </button>
      </div>
    </div>
  );
}

export default function PlayerNameAliasPanel({
  leagueId,
  season,
  isCommissioner,
  onUpdated,
  mapRequest = null,
  onClearMapRequest,
}) {
  const [rows, setRows] = useState([]);
  const [unmapped, setUnmapped] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingUnmapped, setLoadingUnmapped] = useState(false);
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");
  const [editDraft, setEditDraft] = useState(null);
  const [showSavedMaps, setShowSavedMaps] = useState(false);

  const groupedRows = useMemo(() => groupAliasRows(rows), [rows]);
  const savedMapCount = rows.length;

  const applySavedRow = useCallback((savedRow) => {
    if (!savedRow?.alias_name) return;
    setRows((prev) => {
      const existing = prev.find((r) => r.alias_name === savedRow.alias_name);
      const merged = { ...existing, ...savedRow };
      const rest = prev.filter((r) => r.alias_name !== savedRow.alias_name);
      return [...rest, merged].sort((a, b) => (
        String(a.alias_name || "").localeCompare(String(b.alias_name || ""))
      ));
    });
    setUnmapped((prev) => prev.filter((u) => u.alias_name !== savedRow.alias_name));
  }, []);

  const aliasQueryParams = useCallback((includeUnmapped) => {
    const params = new URLSearchParams();
    if (includeUnmapped) params.set("include_unmapped", "1");
    if (season) params.set("season", String(season));
    return params;
  }, [season]);

  const loadRows = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const params = aliasQueryParams(false);
      const qs = params.toString();
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/player-name-aliases${qs ? `?${qs}` : ""}`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setRows(payload.rows || []);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId, aliasQueryParams]);

  const loadUnmapped = useCallback(async () => {
    if (!leagueId || !season) return;
    setLoadingUnmapped(true);
    try {
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/player-name-aliases?${aliasQueryParams(true)}`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setRows(payload.rows || []);
      setUnmapped(payload.unmapped_names || []);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoadingUnmapped(false);
    }
  }, [leagueId, season, aliasQueryParams]);

  useEffect(() => {
    if (!leagueId) return;
    loadRows();
    if (season) loadUnmapped();
  }, [leagueId, season, loadRows, loadUnmapped]);

  const afterSave = useCallback((savedRow) => {
    applySavedRow(savedRow);
    onUpdated?.();
  }, [applySavedRow, onUpdated]);

  useEffect(() => {
    if (mapRequest?.alias_name) {
      const existing = rows.find((r) => r.alias_name === mapRequest.alias_name);
      setEditDraft({
        alias_name: mapRequest.alias_name,
        position: mapRequest.position || existing?.position || "",
        canonical_name: mapRequest.canonical_name || existing?.canonical_name || "",
        sleeper_player_id: mapRequest.sleeper_player_id || existing?.sleeper_player_id || "",
      });
      onClearMapRequest?.();
    }
  }, [mapRequest, rows, onClearMapRequest]);

  const remove = useCallback(
    async (row) => {
      if (!row?.id) return;
      setDeleting(String(row.id));
      setError("");
      try {
        const res = await apiFetch(
          `/api/hub/league/${leagueId}/player-name-aliases/${row.id}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(await parseApiError(res));
        setRows((prev) => prev.filter((r) => r.id !== row.id));
        setUnmapped((prev) => prev.filter((u) => u.alias_name !== row.alias_name));
        onUpdated?.();
      } catch (e) {
        setError(connectionErrorMessage(e));
      } finally {
        setDeleting("");
      }
    },
    [leagueId, onUpdated],
  );

  const quickMap = useCallback(
    async (item, suggestion) => {
      setError("");
      try {
        const body = {
          alias_name: item.alias_name,
          position: mapFormPosition(item.position) || suggestion?.position || undefined,
        };
        if (suggestion?.sleeper_player_id) {
          body.sleeper_player_id = String(suggestion.sleeper_player_id);
        }
        if (suggestion?.player_name) {
          body.canonical_name = suggestion.player_name;
        }
        const res = await apiFetch(`/api/hub/league/${leagueId}/player-name-aliases`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        afterSave(await res.json());
      } catch (e) {
        setError(connectionErrorMessage(e));
      }
    },
    [leagueId, afterSave],
  );

  const formProps = editDraft
    ? {
        initialAlias: editDraft.alias_name,
        initialPosition: editDraft.position,
        initialCanonical: editDraft.canonical_name,
        initialSleeperId: editDraft.sleeper_player_id,
        onCancel: () => setEditDraft(null),
        onSaved: (savedRow) => {
          setEditDraft(null);
          afterSave(savedRow);
        },
      }
    : {
        onSaved: afterSave,
      };

  if (!isCommissioner) return null;

  return (
    <section className="hub-player-alias panel">
      <h3 className="hub-live-section-title">Player name maps</h3>
      <p className="chart-note">
        Cap sheets often use last names only. Map those aliases to a Sleeper player so roster audit and draft
        matching treat them as the same person. Multiple cap-sheet names can point to one Sleeper player.
      </p>
      {error && <p className="error-banner">{error}</p>}
      {loading && !rows.length && <p className="chart-note">Loading name maps…</p>}
      {!season && !loadingUnmapped && (
        <p className="chart-note">Waiting for roster season to load prior-team context…</p>
      )}

      <PlayerNameMapForm leagueId={leagueId} season={season} {...formProps} />

      {season && loadingUnmapped && !unmapped.length && (
        <p className="chart-note">Scanning cap sheets for abbreviations…</p>
      )}

      {unmapped?.length > 0 && (
        <div className="hub-player-alias-unmapped">
          <div className="hub-section-head hub-section-head--row">
            <h4 className="hub-live-section-title">Likely abbreviations</h4>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={loadingUnmapped || !season}
              onClick={loadUnmapped}
            >
              {loadingUnmapped ? "Scanning…" : "Rescan"}
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Cap sheet name</th>
                  <th>Prior team</th>
                  <th>Pos</th>
                  <th>Suggested Sleeper match</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {unmapped.map((item) => {
                  const top = item.suggestions?.[0];
                  return (
                    <tr key={item.alias_name}>
                      <td>{item.alias_name}</td>
                      <td>{priorTeamLabel(item)}</td>
                      <td>{item.position || "—"}</td>
                      <td>{top ? suggestionLabel(top) : "—"}</td>
                      <td>
                        {top && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => quickMap(item, top)}
                          >
                            Map
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setEditDraft({
                            alias_name: item.alias_name,
                            position: item.position || top?.position || "",
                            canonical_name: top?.player_name || "",
                            sleeper_player_id: top?.sleeper_player_id || "",
                          })}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {savedMapCount > 0 && (
        <div className="hub-player-alias-groups">
          <div className="hub-section-head hub-section-head--row">
            <h4 className="hub-live-section-title">
              Saved maps
              <span className="table-meta"> · {savedMapCount} alias{savedMapCount === 1 ? "" : "es"}</span>
            </h4>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setShowSavedMaps((open) => !open)}
            >
              {showSavedMaps ? "Hide" : "Show"}
            </button>
          </div>
          {showSavedMaps && groupedRows.map((group) => (
            <div key={group.sleeper_player_id || group.canonical_name} className="hub-player-alias-group panel">
              <div className="hub-player-alias-group-head">
                <strong>{group.canonical_name}</strong>
                <span className="table-meta">
                  {group.position ? `${group.position} · ` : ""}
                  {group.sleeper_player_id ? `Sleeper ${group.sleeper_player_id}` : "Manual name"}
                </span>
              </div>
              <div className="hub-filter-scroll">
                {group.aliases.map((r) => (
                  <span key={r.id || r.alias_name} className="hub-player-alias-chip">
                    {r.alias_name}
                    {r.prior_team_display || r.prior_owner_label ? (
                      <span className="table-meta">
                        {" "}
                        · {priorTeamLabel(r)}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="btn-link btn-sm"
                      disabled={deleting === String(r.id)}
                      onClick={() => remove(r)}
                      aria-label={`Remove alias ${r.alias_name}`}
                    >
                      {deleting === String(r.id) ? "…" : "×"}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddBySleeperIdForm leagueId={leagueId} onSaved={afterSave} />
    </section>
  );
}
