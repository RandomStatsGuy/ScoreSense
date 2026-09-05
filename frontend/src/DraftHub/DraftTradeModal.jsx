import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";
import { HubFilterMenu } from "./HubUILayout";
import { fmtSal } from "./rosterFormat";

function sortRoster(rows) {
  return [...(rows || [])].sort((a, b) => {
    const pa = HUB_POS_ORDER.indexOf(normalizeHubPosition(a.position));
    const pb = HUB_POS_ORDER.indexOf(normalizeHubPosition(b.position));
    const ai = pa >= 0 ? pa : 99;
    const bi = pb >= 0 ? pb : 99;
    if (ai !== bi) return ai - bi;
    return String(a.player_name || "").localeCompare(String(b.player_name || ""));
  });
}

function playerLabel(row) {
  if (!row) return "Player";
  return `${row.player_name || row.player_id} ${fmtSal(row.salary)}`;
}

function CompactRoster({ title, rows, selected, onToggle, empty }) {
  return (
    <div className="hub-draft-trade-col">
      <strong className="hub-draft-trade-col-title">{title}</strong>
      {rows.length === 0 ? (
        <p className="chart-note">{empty}</p>
      ) : (
        <ul className="hub-draft-trade-list">
          {rows.map((row) => {
            const on = selected.has(row.player_id);
            return (
              <li key={row.player_id}>
                <label className={`hub-draft-trade-pick${on ? " is-on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(row.player_id)}
                  />
                  <span className="hub-roster-pos">{normalizeHubPosition(row.position)}</span>
                  <span className="hub-draft-trade-name">{row.player_name}</span>
                  <span className="hub-roster-sal">{fmtSal(row.salary)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function DraftTradeModal({
  leagueId,
  myTeamId,
  teams = [],
  rosters = {},
  seed = null,
  initialView = "builder",
  onClose,
  onApplied,
}) {
  const partners = useMemo(
    () => teams.filter((t) => t.id && t.id !== myTeamId && !t.is_bot),
    [teams, myTeamId],
  );
  const [view, setView] = useState(initialView === "inbox" ? "inbox" : "builder");
  const [partnerId, setPartnerId] = useState(() => {
    if (seed && !seed.mine && seed.team_id && seed.team_id !== myTeamId) return seed.team_id;
    return partners[0]?.id || "";
  });
  const [sendMine, setSendMine] = useState(() => (
    seed?.mine && seed.player_id ? new Set([seed.player_id]) : new Set()
  ));
  const [sendTheirs, setSendTheirs] = useState(() => (
    seed && !seed.mine && seed.player_id ? new Set([seed.player_id]) : new Set()
  ));
  const [proposals, setProposals] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const mine = useMemo(() => sortRoster(rosters[myTeamId] || []), [rosters, myTeamId]);
  const theirs = useMemo(() => sortRoster(rosters[partnerId] || []), [rosters, partnerId]);
  const teamName = (id) => teams.find((t) => t.id === id)?.name || "Team";
  const nameFor = (playerId) => {
    for (const rows of Object.values(rosters || {})) {
      const hit = (rows || []).find((r) => r.player_id === playerId);
      if (hit) return hit.player_name;
    }
    return playerId;
  };

  useEffect(() => {
    if (!leagueId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades?status=pending`);
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        if (!cancelled) setProposals(data.proposals || []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load trades");
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

  const toggle = (setter) => (playerId) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
    setError("");
    setNote("");
  };

  const hasPackage = sendMine.size + sendTheirs.size > 0 && Boolean(partnerId);

  const buildPayload = () => ({
    parties: [
      {
        team_id: myTeamId,
        sends: [...sendMine].map((player_id) => ({ player_id, to_team_id: partnerId })),
        drops: [],
      },
      {
        team_id: partnerId,
        sends: [...sendTheirs].map((player_id) => ({ player_id, to_team_id: myTeamId })),
        drops: [],
      },
    ],
    dead_cap_assignments: [],
  });

  const propose = async () => {
    if (!hasPackage) return;
    setBusy("propose");
    setError("");
    setNote("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setProposals((prev) => [data.proposal, ...prev.filter((p) => p.id !== data.proposal?.id)]);
      setNote("Offer sent — waiting for them to accept.");
      setView("inbox");
    } catch (e) {
      setError(e.message || "Could not propose trade");
    } finally {
      setBusy("");
    }
  };

  const respond = async (proposalId, approve) => {
    setBusy(proposalId);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/trades/${encodeURIComponent(proposalId)}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approve }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const status = data.proposal?.status;
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      if (status === "executed") {
        setNote("Trade completed. Rosters and budgets updated.");
        onApplied?.();
      } else {
        setNote(approve ? "Accepted." : "Declined.");
      }
    } catch (e) {
      setError(e.message || "Could not respond");
    } finally {
      setBusy("");
    }
  };

  const relevant = proposals.filter((p) => (
    (p.parties || []).some((party) => party.team_id === myTeamId)
  ));

  return (
    <div
      className="hub-draft-trade-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="hub-draft-trade-card panel" role="dialog" aria-modal="true" aria-label="Draft trade">
        <header className="hub-draft-trade-head">
          <div>
            <p className="hub-owner-report-kicker">Live draft</p>
            <h3>Trade</h3>
          </div>
          <div className="hub-draft-trade-tabs">
            <button
              type="button"
              className={`btn-ghost btn-sm${view === "builder" ? " active" : ""}`}
              onClick={() => setView("builder")}
            >
              Offer
            </button>
            <button
              type="button"
              className={`btn-ghost btn-sm${view === "inbox" ? " active" : ""}`}
              onClick={() => setView("inbox")}
            >
              Inbox{relevant.length ? ` · ${relevant.length}` : ""}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {note && <p className="chart-note hub-draft-trade-note">{note}</p>}

        {view === "builder" && (
          <>
            <HubFilterMenu
              label="With"
              value={partnerId}
              options={
                partners.length === 0
                  ? [{ id: "", label: "No human partners" }]
                  : partners.map((t) => ({ id: t.id, label: t.name }))
              }
              onChange={(id) => {
                setPartnerId(id);
                setSendTheirs(new Set());
                setError("");
              }}
            />
            <div className="hub-draft-trade-grid">
              <CompactRoster
                title="You send"
                rows={mine}
                selected={sendMine}
                onToggle={toggle(setSendMine)}
                empty="No players on your roster yet."
              />
              <CompactRoster
                title={`${teamName(partnerId) || "Them"} send`}
                rows={theirs}
                selected={sendTheirs}
                onToggle={toggle(setSendTheirs)}
                empty="That team has no players yet."
              />
            </div>
            <p className="chart-note hub-draft-trade-summary">
              {hasPackage
                ? `You send ${[...sendMine].map((id) => playerLabel(mine.find((r) => r.player_id === id))).join(", ") || "—"}; get ${[...sendTheirs].map((id) => playerLabel(theirs.find((r) => r.player_id === id))).join(", ") || "—"}.`
                : "Select at least one player on either side."}
            </p>
            <div className="hub-draft-trade-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={!hasPackage || busy === "propose" || !partnerId}
                onClick={propose}
              >
                {busy === "propose" ? "Sending…" : "Propose trade"}
              </button>
            </div>
          </>
        )}

        {view === "inbox" && (
          <ul className="hub-draft-trade-inbox">
            {relevant.length === 0 && (
              <li className="chart-note">No pending trades for your team.</li>
            )}
            {relevant.map((p) => {
              const mineParty = (p.parties || []).find((x) => x.team_id === myTeamId);
              const other = (p.parties || []).find((x) => x.team_id !== myTeamId);
              const waitingOnMe = (p.acceptances || {})[myTeamId] === "pending";
              return (
                <li key={p.id} className="hub-draft-trade-inbox-item">
                  <p>
                    <strong>{teamName(other?.team_id)}</strong>
                    {" · you send "}
                    {(mineParty?.sends || []).map((s) => nameFor(s.player_id)).join(", ") || "nothing"}
                    {" · get "}
                    {(other?.sends || []).map((s) => nameFor(s.player_id)).join(", ") || "nothing"}
                  </p>
                  {waitingOnMe ? (
                    <div className="hub-draft-trade-actions">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={Boolean(busy)}
                        onClick={() => respond(p.id, false)}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={Boolean(busy)}
                        onClick={() => respond(p.id, true)}
                      >
                        Accept
                      </button>
                    </div>
                  ) : (
                    <p className="chart-note">Waiting on {teamName(other?.team_id)}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
