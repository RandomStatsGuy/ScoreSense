import React, { useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { HubFilterMenu } from "./HubUILayout";
import { isPickDraft } from "./draftEntryStatus";

export default function DraftCommissionerSettings({
  leagueId,
  rules,
  teams,
  nominationOrder = [],
  poolMode = "full",
  testMode = false,
  disabled,
  onUpdated,
}) {
  const auction = rules?.auction || {};
  const pickDraft = isPickDraft(rules);
  const [bidTimer, setBidTimer] = useState(auction.bid_timer_sec ?? 30);
  const [nomTimer, setNomTimer] = useState(auction.nomination_timer_sec ?? 60);
  const [botDelay, setBotDelay] = useState(auction.bot_reaction_delay_sec ?? 4);
  const [nomPool, setNomPool] = useState(poolMode === "roster_plus_rookies" ? "roster_plus_rookies" : "full");
  const [order, setOrder] = useState([]);
  const [relaxLimits, setRelaxLimits] = useState(Boolean(rules?.relax_salary_roster_limits));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setBidTimer(auction.bid_timer_sec ?? 30);
    setNomTimer(auction.nomination_timer_sec ?? 60);
    setBotDelay(auction.bot_reaction_delay_sec ?? 4);
  }, [auction.bid_timer_sec, auction.nomination_timer_sec, auction.bot_reaction_delay_sec]);

  useEffect(() => {
    setNomPool(poolMode === "roster_plus_rookies" ? "roster_plus_rookies" : "full");
  }, [poolMode]);

  useEffect(() => {
    setRelaxLimits(Boolean(rules?.relax_salary_roster_limits));
  }, [rules?.relax_salary_roster_limits]);

  useEffect(() => {
    const next = nominationOrder?.length
      ? nominationOrder.map(String)
      : (teams || []).map((t) => String(t.id));
    // Bail out when unchanged: parent passes fresh array identities each render,
    // so unconditionally setting a new array here causes an infinite render loop.
    setOrder((prev) =>
      prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next,
    );
  }, [nominationOrder, teams]);

  const move = (idx, dir) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
  };

  const save = async () => {
    if (!leagueId) return;
    setSaving(true);
    setError("");
    try {
      const rulesRes = await apiFetch(`/api/hub/league/${leagueId}/auction-rules`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bid_timer_sec: Number(bidTimer),
          nomination_timer_sec: Number(nomTimer),
          bot_reaction_delay_sec: Number(botDelay),
          ...(testMode ? { relax_salary_roster_limits: relaxLimits } : {}),
        }),
      });
      if (!rulesRes.ok) throw new Error(await parseApiError(rulesRes));
      const orderRes = await apiFetch(`/api/hub/league/${leagueId}/nomination-order`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_ids: order }),
      });
      if (!orderRes.ok) throw new Error(await parseApiError(orderRes));
      let state = await orderRes.json();
      if (nomPool !== poolMode) {
        const poolRes = await apiFetch(`/api/hub/league/${leagueId}/pool-mode`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pool_mode: nomPool }),
        });
        if (!poolRes.ok) throw new Error(await parseApiError(poolRes));
        state = await poolRes.json();
      }
      onUpdated?.(state);
    } catch (e) {
      setError(e.message || "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const teamName = (id) => (teams || []).find((t) => String(t.id) === String(id))?.name || id;

  return (
    <div className="hub-draft-commissioner-settings">
      <strong>Draft settings</strong>
      <div className="hub-form-row hub-draft-settings-grid">
        {!pickDraft && (
        <label>
          Bid timer (sec)
          <input type="number" min={10} max={120} value={bidTimer} disabled={disabled || saving} onChange={(e) => setBidTimer(e.target.value)} />
        </label>
        )}
        <label>
          {pickDraft ? "Pick clock (sec)" : "Nomination timer (sec)"}
          <input type="number" min={15} max={180} value={nomTimer} disabled={disabled || saving} onChange={(e) => setNomTimer(e.target.value)} />
        </label>
        <label>
          Bot delay (sec)
          <input type="number" min={2} max={30} value={botDelay} disabled={disabled || saving} onChange={(e) => setBotDelay(e.target.value)} />
        </label>
      </div>
      <HubFilterMenu
        label={pickDraft ? "Who can be drafted" : "Who can be nominated"}
        value={nomPool}
        options={[
          { id: "full", label: "Any undrafted NFL player" },
          { id: "roster_plus_rookies", label: "Keeper league — keepers off, FA and expirees in" },
        ]}
        onChange={setNomPool}
        disabled={disabled || saving}
      />
      <p className="chart-note hub-draft-pool-hint">
        Keeper mode hides players retained through the draft. Expirees, cuts, and undrafted rookies stay nominatable.
      </p>
      {testMode && (
        <>
          <label className="hub-toggle-row hub-toggle-row-compact">
            <input
              type="checkbox"
              checked={relaxLimits}
              onChange={(e) => setRelaxLimits(e.target.checked)}
              disabled={disabled || saving}
            />
            {pickDraft ? "Ignore position limits" : "Ignore salary cap and position limits"}
          </label>
          <p className="chart-note">
            {pickDraft
              ? "Practice only. Lets you pick before roster limits are locked in."
              : "Practice only. Lets you nominate and bid before keeper salaries are updated."}
          </p>
        </>
      )}
      <p className="chart-note">Nomination order:</p>
      <ol className="hub-nomination-order">
        {order.map((teamId, idx) => (
          <li key={teamId}>
            <span>{teamName(teamId)}</span>
            <span className="hub-nomination-order-actions">
              <button type="button" className="btn-ghost btn-sm" disabled={disabled || saving || idx === 0} onClick={() => move(idx, -1)}>↑</button>
              <button type="button" className="btn-ghost btn-sm" disabled={disabled || saving || idx === order.length - 1} onClick={() => move(idx, 1)}>↓</button>
            </span>
          </li>
        ))}
      </ol>
      {error && <div className="error">{error}</div>}
      <button type="button" className="btn-ghost btn-sm" disabled={disabled || saving} onClick={save}>
        {saving ? "Saving…" : "Save draft settings"}
      </button>
    </div>
  );
}
