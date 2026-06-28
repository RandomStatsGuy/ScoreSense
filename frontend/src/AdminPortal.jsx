import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { parseApiError } from "./format";
import useMobileLayout from "./useMobileLayout";
import MobileDataList from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "leagues", label: "Leagues" },
];

function StatCard({ label, value }) {
  return (
    <div className="admin-stat-card">
      <span className="admin-stat-value">{value}</span>
      <span className="admin-stat-label">{label}</span>
    </div>
  );
}

function isTestAccountEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return !e || e.endsWith("@example.com") || e.endsWith("@example.org");
}

function isTestMembership(m) {
  if (m?.test_mode === true || m?.test_mode === 1 || m?.test_mode === "1") return true;
  const name = String(m?.league_name || "").toLowerCase();
  return name.includes("mock draft") || name.includes("(test)");
}

function filterMemberships(memberships, includeTest) {
  if (includeTest) return memberships || [];
  return (memberships || []).filter((m) => !isTestMembership(m));
}

function normalizeUsersPayload(payload, { showTestAccounts, showTestMemberships }) {
  if (!payload) return { accounts: [], systemSubs: [] };
  const mapRow = (row) => {
    const all = row.memberships || [];
    const memberships = filterMemberships(all, showTestMemberships);
    const testHidden = showTestMemberships
      ? 0
      : all.filter((m) => isTestMembership(m)).length;
    return {
      ...row,
      memberships,
      test_membership_count: row.test_membership_count ?? testHidden,
    };
  };
  if (Array.isArray(payload.accounts)) {
    return {
      accounts: payload.accounts.map(mapRow),
      systemSubs: (payload.system_subs || []).map(mapRow),
    };
  }
  // Back-compat: older API returned native_users + patreon_or_other_subs
  const legacyAccounts = payload.native_users || [];
  const accounts = (showTestAccounts ? legacyAccounts : legacyAccounts.filter(
    (row) => !isTestAccountEmail(row.email),
  )).map(mapRow);
  const legacySubs = payload.patreon_or_other_subs || [];
  const systemSubs = legacySubs
    .filter((row) => {
      const sub = String(row.user_sub || "");
      return sub === "dev" || sub === "dummy" || sub === "comm-filter-debug";
    })
    .map(mapRow);
  return { accounts, systemSubs };
}

function MembershipList({ memberships, testHidden = 0 }) {
  if (!memberships?.length && !testHidden) {
    return <span className="admin-muted">No league memberships</span>;
  }
  return (
    <>
      {testHidden > 0 && (
        <p className="admin-muted admin-membership-hidden">
          {testHidden} test / mock-draft {testHidden === 1 ? "league" : "leagues"} hidden
        </p>
      )}
      {memberships?.length ? (
        <ul className="admin-membership-list">
          {memberships.map((m) => (
            <li key={m.team?.id || m.league_id}>
              <strong>{m.league_name}</strong>
              <span className="admin-muted">
                {" "}
                · {m.room_code}
                {m.test_mode || isTestMembership(m) ? " · test" : ""}
                {m.is_commissioner ? " · commissioner" : ""}
                {m.team?.name ? ` · ${m.team.name}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export default function AdminPortal() {
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const [usersPayload, setUsersPayload] = useState(null);
  const [leaguesPayload, setLeaguesPayload] = useState(null);
  const [expandedLeagueId, setExpandedLeagueId] = useState(null);
  const [leagueDetail, setLeagueDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [actionErr, setActionErr] = useState("");

  const [createForm, setCreateForm] = useState({
    name: "",
    season: new Date().getFullYear(),
    team_count: 12,
    commissioner_email: "",
    test_mode: false,
  });
  const [deleteConfirm, setDeleteConfirm] = useState({});
  const [transferEmail, setTransferEmail] = useState({});
  const [inviteForms, setInviteForms] = useState({});
  const [showTestLeagues, setShowTestLeagues] = useState(false);
  const [showTestMemberships, setShowTestMemberships] = useState(false);
  const [showTestAccounts, setShowTestAccounts] = useState(false);
  const [showSystemSubs, setShowSystemSubs] = useState(false);
  const mobileLayout = useMobileLayout();

  const loadUsers = useCallback(async () => {
    const params = new URLSearchParams();
    if (showTestAccounts) params.set("include_test_accounts", "true");
    if (showSystemSubs) params.set("include_system_subs", "true");
    const qs = params.toString();
    const res = await apiFetch(`/api/admin/users${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw new Error(await parseApiError(res));
    setUsersPayload(await res.json());
  }, [showTestAccounts, showSystemSubs]);

  const loadLeagues = useCallback(async () => {
    const res = await apiFetch(
      `/api/admin/leagues?include_test=${showTestLeagues ? "true" : "false"}`,
    );
    if (!res.ok) throw new Error(await parseApiError(res));
    setLeaguesPayload(await res.json());
  }, [showTestLeagues]);

  const loadOverview = useCallback(async () => {
    const res = await apiFetch("/api/admin/overview");
    if (!res.ok) throw new Error(await parseApiError(res));
    setOverview(await res.json());
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadOverview(), loadUsers(), loadLeagues()]);
    } catch (err) {
      setError(err.message || "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadUsers, loadLeagues]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll, showTestLeagues, showTestAccounts, showSystemSubs]);

  const { accounts: accountRows, systemSubs: systemRows } = useMemo(
    () => normalizeUsersPayload(usersPayload, { showTestAccounts, showTestMemberships }),
    [usersPayload, showTestAccounts, showTestMemberships],
  );

  const loadLeagueDetail = useCallback(async (leagueId) => {
    setDetailLoading(true);
    setActionErr("");
    try {
      const res = await apiFetch(`/api/admin/leagues/${leagueId}`);
      if (!res.ok) throw new Error(await parseApiError(res));
      setLeagueDetail(await res.json());
    } catch (err) {
      setActionErr(err.message || "Failed to load league");
      setLeagueDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const toggleLeague = (leagueId) => {
    if (expandedLeagueId === leagueId) {
      setExpandedLeagueId(null);
      setLeagueDetail(null);
      return;
    }
    setExpandedLeagueId(leagueId);
    loadLeagueDetail(leagueId);
  };

  const renderUserRow = (row) => (
    <tr key={row.user_sub}>
      <td>
        <div>{row.email || row.display_name || "—"}</div>
        <code className="admin-code">{row.user_sub}</code>
      </td>
      <td>{row.auth_type}</td>
      <td>
        {row.workspace_id ? (
          <span className="admin-muted">
            {row.workspace_id.slice(0, 8)}… · {row.workspace_season}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td>
        <MembershipList
          memberships={row.memberships}
          testHidden={
            showTestMemberships
              ? 0
              : row.test_membership_count ??
                (row.memberships || []).filter((m) => isTestMembership(m)).length
          }
        />
      </td>
    </tr>
  );

  const handleUnlink = async (leagueId, teamId, forceCommissioner = false) => {
    setActionMsg("");
    setActionErr("");
    const qs = forceCommissioner ? "?force_commissioner=true" : "";
    try {
      const res = await apiFetch(
        `/api/admin/leagues/${leagueId}/teams/${teamId}/unlink${qs}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setActionMsg("Team unlinked from account");
      await loadLeagues();
      if (expandedLeagueId === leagueId) await loadLeagueDetail(leagueId);
      await loadUsers();
      await loadOverview();
    } catch (err) {
      setActionErr(err.message || "Unlink failed");
    }
  };

  const handleCreateLeague = async (event) => {
    event.preventDefault();
    setActionMsg("");
    setActionErr("");
    try {
      const res = await apiFetch("/api/admin/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name.trim(),
          season: Number(createForm.season),
          team_count: Number(createForm.team_count),
          commissioner_email: createForm.commissioner_email.trim() || undefined,
          test_mode: Boolean(createForm.test_mode),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const body = await res.json();
      setActionMsg(
        body.already_in_league
          ? `Commissioner already in league: ${body.league?.name}`
          : `Created league ${body.league?.name} (${body.league?.room_code})`,
      );
      setCreateForm((f) => ({ ...f, name: "" }));
      await refreshAll();
    } catch (err) {
      setActionErr(err.message || "Create failed");
    }
  };

  const handleTransferCommissioner = async (leagueId) => {
    const email = (transferEmail[leagueId] || "").trim();
    if (!email) {
      setActionErr("Enter the new commissioner email");
      return;
    }
    setActionMsg("");
    setActionErr("");
    try {
      const res = await apiFetch(`/api/admin/leagues/${leagueId}/transfer-commissioner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissioner_email: email }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setActionMsg("Commissioner transferred");
      await loadLeagues();
      await loadLeagueDetail(leagueId);
      await loadUsers();
    } catch (err) {
      setActionErr(err.message || "Transfer failed");
    }
  };

  const handleInvite = async (leagueId) => {
    const form = inviteForms[leagueId] || {};
    const email = String(form.email || "").trim();
    const teamName = String(form.team_name || "").trim();
    if (!email || !teamName) {
      setActionErr("Email and team are required for invites");
      return;
    }
    setActionMsg("");
    setActionErr("");
    try {
      const res = await apiFetch(`/api/admin/leagues/${leagueId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, team_name: teamName }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const body = await res.json();
      const sent = body.invite?.email_sent ? " (email sent)" : "";
      setActionMsg(`Invite created for ${teamName}${sent}`);
      setInviteForms((f) => ({ ...f, [leagueId]: { email: "", team_name: teamName } }));
      await loadLeagueDetail(leagueId);
    } catch (err) {
      setActionErr(err.message || "Invite failed");
    }
  };

  const handleDeleteLeague = async (league) => {
    const code = (deleteConfirm[league.id] || "").trim();
    if (!code) {
      setActionErr("Enter room code to confirm delete");
      return;
    }
    setActionMsg("");
    setActionErr("");
    try {
      const res = await apiFetch(
        `/api/admin/leagues/${league.id}?confirm=${encodeURIComponent(code)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setActionMsg(`Deleted league ${league.name}`);
      setDeleteConfirm((d) => ({ ...d, [league.id]: "" }));
      if (expandedLeagueId === league.id) {
        setExpandedLeagueId(null);
        setLeagueDetail(null);
      }
      await refreshAll();
    } catch (err) {
      setActionErr(err.message || "Delete failed");
    }
  };

  if (loading && !overview) {
    return <div className="admin-portal admin-portal-loading">Loading admin data…</div>;
  }

  if (error && !overview) {
    return (
      <div className="admin-portal">
        <div className="error">{error}</div>
        <button type="button" className="btn-primary" onClick={refreshAll}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="admin-portal">
      <div className="admin-portal-head">
        <nav className="app-section-subnav" aria-label="Admin sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`app-section-subnav-btn${tab === item.id ? " active" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button type="button" className="btn-ghost btn-sm" onClick={refreshAll} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {actionMsg && <div className="admin-notice admin-notice-success">{actionMsg}</div>}
      {actionErr && <div className="error admin-notice">{actionErr}</div>}

      {tab === "overview" && overview && (
        <section className="admin-panel panel">
          <div className="admin-stat-grid">
            <StatCard label="Registered accounts" value={overview.native_user_count} />
            <StatCard label="Live leagues" value={overview.live_league_count ?? "—"} />
            <StatCard label="Test leagues" value={overview.test_league_count} />
            <StatCard label="Mock-draft bots" value={overview.bot_sub_count ?? "—"} />
          </div>
          <p className="admin-muted admin-panel-note">
            Mock drafts create temporary <code>bot:*</code> identities for AI bidders — not real user
            accounts. Each practice league also adds a commissioner membership row for your account.
          </p>
        </section>
      )}

      {tab === "users" && (
        <section className="admin-panel panel">
          <div className="admin-filter-bar">
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={showTestMemberships}
                onChange={(e) => setShowTestMemberships(e.target.checked)}
              />
              Show test league memberships
            </label>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={showTestAccounts}
                onChange={(e) => setShowTestAccounts(e.target.checked)}
              />
              Show @example.com test accounts
            </label>
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={showSystemSubs}
                onChange={(e) => setShowSystemSubs(e.target.checked)}
              />
              Show system subs (dev, dummy)
            </label>
          </div>
          <div className={`admin-table-wrap${mobileLayout ? " admin-table-wrap--desktop-only" : ""}`}>
            <table className="data-table hub-table admin-table">
              <thead>
                <tr>
                  <th>Email / sub</th>
                  <th>Auth</th>
                  <th>Workspace</th>
                  <th>League memberships</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map(renderUserRow)}
                {!accountRows.length && (
                  <tr>
                    <td colSpan={4} className="admin-muted">
                      No registered accounts match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {mobileLayout ? (
            <MobileDataList className="admin-mobile-list" emptyMessage="No registered accounts match the current filters.">
              {accountRows.map((row) => (
                <MobilePlayerCard
                  key={row.user_sub}
                  name={row.email || row.display_name || row.user_sub}
                  meta={`${row.auth_type} · ${row.workspace_id ? `${row.workspace_id.slice(0, 8)}… · ${row.workspace_season}` : "No workspace"}`}
                  heroValue={(row.memberships || []).length}
                  heroLabel="leagues"
                  expanded={(
                    <MembershipList
                      memberships={row.memberships}
                      testHidden={
                        showTestMemberships
                          ? 0
                          : row.test_membership_count ??
                            (row.memberships || []).filter((m) => isTestMembership(m)).length
                      }
                    />
                  )}
                />
              ))}
            </MobileDataList>
          ) : null}
          {showSystemSubs && systemRows.length > 0 && (
            <>
              <h3 className="admin-section-title">System / dev identities</h3>
              <div className="admin-table-wrap">
                <table className="data-table hub-table admin-table">
                  <thead>
                    <tr>
                      <th>Sub</th>
                      <th>Auth</th>
                      <th>Workspace</th>
                      <th>League memberships</th>
                    </tr>
                  </thead>
                  <tbody>{systemRows.map(renderUserRow)}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {tab === "leagues" && (
        <>
          <div className="admin-filter-bar">
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={showTestLeagues}
                onChange={(e) => setShowTestLeagues(e.target.checked)}
              />
              Show test / mock-draft leagues
            </label>
          </div>
          <section className="admin-panel panel admin-create-form">
            <h3 className="admin-section-title">Create league</h3>
            <form className="admin-form" onSubmit={handleCreateLeague}>
              <label>
                Name
                <input
                  required
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label>
                Season
                <input
                  type="number"
                  min={2015}
                  max={2035}
                  value={createForm.season}
                  onChange={(e) => setCreateForm((f) => ({ ...f, season: e.target.value }))}
                />
              </label>
              <label>
                Teams
                <input
                  type="number"
                  min={2}
                  max={32}
                  value={createForm.team_count}
                  onChange={(e) => setCreateForm((f) => ({ ...f, team_count: e.target.value }))}
                />
              </label>
              <label>
                Commissioner email
                <input
                  type="email"
                  placeholder="account@example.com"
                  value={createForm.commissioner_email}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, commissioner_email: e.target.value }))
                  }
                />
              </label>
              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={createForm.test_mode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, test_mode: e.target.checked }))}
                />
                Test / practice league
              </label>
              <button type="submit" className="btn-primary">
                Create
              </button>
            </form>
          </section>

          <section className="admin-panel panel">
            <h3 className="admin-section-title">All leagues ({leaguesPayload?.count ?? 0})</h3>
            <div className={`admin-table-wrap${mobileLayout ? " admin-table-wrap--desktop-only" : ""}`}>
              <table className="data-table hub-table admin-table">
                <thead>
                  <tr>
                    <th aria-label="Expand" />
                    <th>Name</th>
                    <th>Room</th>
                    <th>Season</th>
                    <th>Members</th>
                    <th>Commissioner</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {(leaguesPayload?.leagues || []).map((lg) => (
                    <React.Fragment key={lg.id}>
                      <tr className={expandedLeagueId === lg.id ? "admin-row-expanded" : ""}>
                        <td>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            aria-expanded={expandedLeagueId === lg.id}
                            onClick={() => toggleLeague(lg.id)}
                          >
                            {expandedLeagueId === lg.id ? "▼" : "▶"}
                          </button>
                        </td>
                        <td>
                          {lg.name}
                          {lg.test_mode ? <span className="admin-badge">test</span> : null}
                        </td>
                        <td>
                          <code>{lg.room_code}</code>
                        </td>
                        <td>{lg.season}</td>
                        <td>
                          {lg.member_count}/{lg.team_rows}
                        </td>
                        <td>{lg.commissioner_email || lg.commissioner_sub}</td>
                        <td>
                          <div className="admin-delete-row">
                            <input
                              type="text"
                              placeholder={lg.room_code}
                              value={deleteConfirm[lg.id] || ""}
                              onChange={(e) =>
                                setDeleteConfirm((d) => ({ ...d, [lg.id]: e.target.value }))
                              }
                              aria-label={`Confirm delete ${lg.name}`}
                            />
                            <button
                              type="button"
                              className="btn-ghost btn-sm admin-danger"
                              onClick={() => handleDeleteLeague(lg)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedLeagueId === lg.id && (
                        <tr>
                          <td colSpan={7} className="admin-detail-cell">
                            {detailLoading && <p>Loading teams…</p>}
                            {!detailLoading && leagueDetail && (
                              <>
                                <div className="admin-league-actions">
                                  <div className="admin-inline-form">
                                    <strong>Transfer commissioner</strong>
                                    <input
                                      type="email"
                                      placeholder="new commissioner email"
                                      value={transferEmail[lg.id] || ""}
                                      onChange={(e) =>
                                        setTransferEmail((t) => ({
                                          ...t,
                                          [lg.id]: e.target.value,
                                        }))
                                      }
                                    />
                                    <button
                                      type="button"
                                      className="btn-ghost btn-sm"
                                      onClick={() => handleTransferCommissioner(lg.id)}
                                    >
                                      Transfer
                                    </button>
                                  </div>
                                  <div className="admin-inline-form">
                                    <strong>Invite to team</strong>
                                    <input
                                      type="email"
                                      placeholder="email"
                                      value={inviteForms[lg.id]?.email || ""}
                                      onChange={(e) =>
                                        setInviteForms((f) => ({
                                          ...f,
                                          [lg.id]: {
                                            ...(f[lg.id] || {}),
                                            email: e.target.value,
                                          },
                                        }))
                                      }
                                    />
                                    <select
                                      value={inviteForms[lg.id]?.team_name || ""}
                                      onChange={(e) =>
                                        setInviteForms((f) => ({
                                          ...f,
                                          [lg.id]: {
                                            ...(f[lg.id] || {}),
                                            team_name: e.target.value,
                                          },
                                        }))
                                      }
                                    >
                                      <option value="">Select team…</option>
                                      {(leagueDetail.teams || [])
                                        .filter((t) => !t.user_sub && !t.is_bot)
                                        .map((t) => (
                                          <option key={t.id} value={t.name}>
                                            {t.name}
                                          </option>
                                        ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="btn-primary btn-sm"
                                      onClick={() => handleInvite(lg.id)}
                                    >
                                      Send invite
                                    </button>
                                  </div>
                                </div>
                                {(leagueDetail.invites || []).length > 0 && (
                                  <div className="admin-invites-block">
                                    <strong>Pending invites</strong>
                                    <ul className="admin-membership-list">
                                      {(leagueDetail.invites || [])
                                        .filter((inv) => inv.status === "pending")
                                        .map((inv) => (
                                          <li key={inv.id}>
                                            {inv.email} · {inv.team_name}
                                            {inv.invite_url ? (
                                              <>
                                                {" "}
                                                ·{" "}
                                                <a href={inv.invite_url} target="_blank" rel="noreferrer">
                                                  link
                                                </a>
                                              </>
                                            ) : null}
                                          </li>
                                        ))}
                                    </ul>
                                  </div>
                                )}
                                <table className="data-table hub-table admin-nested-table">
                                <thead>
                                  <tr>
                                    <th>Team</th>
                                    <th>Account</th>
                                    <th>Role</th>
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {(leagueDetail.teams || []).map((team) => (
                                    <tr key={team.id}>
                                      <td>{team.name}</td>
                                      <td>
                                        {team.user_sub ? (
                                          <>
                                            <div>{team.user_email || "—"}</div>
                                            <code className="admin-code">{team.user_sub}</code>
                                          </>
                                        ) : (
                                          <span className="admin-muted">Unclaimed</span>
                                        )}
                                      </td>
                                      <td>
                                        {team.is_commissioner ? "Commissioner" : "Member"}
                                      </td>
                                      <td>
                                        {team.user_sub ? (
                                          <button
                                            type="button"
                                            className="btn-ghost btn-sm admin-danger"
                                            onClick={() =>
                                              handleUnlink(
                                                lg.id,
                                                team.id,
                                                Boolean(team.is_commissioner),
                                              )
                                            }
                                          >
                                            Unlink
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {mobileLayout ? (
              <MobileDataList className="admin-mobile-list" emptyMessage="No leagues match the current filters.">
                {(leaguesPayload?.leagues || []).map((lg) => (
                  <MobilePlayerCard
                    key={lg.id}
                    name={lg.name}
                    badge={lg.test_mode ? <span className="admin-badge">test</span> : null}
                    meta={`${lg.room_code} · ${lg.season} · ${lg.member_count}/${lg.team_rows} teams`}
                    heroValue={lg.commissioner_email || lg.commissioner_sub || "—"}
                    heroLabel="comm."
                    onSelect={() => toggleLeague(lg.id)}
                    expanded={expandedLeagueId === lg.id && leagueDetail ? (
                      <div className="admin-mobile-league-detail">
                        <p className="chart-note">
                          Commissioner: {lg.commissioner_email || lg.commissioner_sub}
                        </p>
                        <div className="admin-delete-row">
                          <input
                            type="text"
                            placeholder={lg.room_code}
                            value={deleteConfirm[lg.id] || ""}
                            onChange={(e) =>
                              setDeleteConfirm((d) => ({ ...d, [lg.id]: e.target.value }))
                            }
                            aria-label={`Confirm delete ${lg.name}`}
                          />
                          <button
                            type="button"
                            className="btn-ghost btn-sm admin-danger"
                            onClick={() => handleDeleteLeague(lg)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : null}
                  />
                ))}
              </MobileDataList>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
