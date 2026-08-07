import React, { useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";

export default function DraftCommissionerSettings({
  leagueId,
  rules,
  teams,
  nominationOrder = [],
  poolMode = "full",
  disabled,
  onUpdated,
}) {
  const auction = rules?.auction || {};
  const [bidTimer, setBidTimer] = useState(auction.bid_timer_sec ?? 30);
  const [nomTimer, setNomTimer] = useState(auction.nomination_timer_sec ?? 60);
  const [botDelay, setBotDelay] = useState(auction.bot_reaction_delay_sec ?? 4);
  const [nomPool, setNomPool] = useState(poolMode === "roster_plus_rookies" ? "roster_plus_rookies" : "full");
  const [order, setOrder] = useState([]);
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
        <label>
          Bid timer (sec)
          <input type="number" min={10} max={120} value={bidTimer} disabled={disabled || saving} onChange={(e) => setBidTimer(e.target.value)} />
        </label>
        <label>
          Nomination timer (sec)
          <input type="number" min={15} max={180} value={nomTimer} disabled={disabled || saving} onChange={(e) => setNomTimer(e.target.value)} />
        </label>
        <label>
          Bot delay (sec)
          <input type="number" min={2} max={30} value={botDelay} disabled={disabled || saving} onChange={(e) => setBotDelay(e.target.value)} />
        </label>
      </div>
      <label className="hub-draft-pool-setting">
        Who can be nominated
        <select value={nomPool} disabled={disabled || saving} onChange={(e) => setNomPool(e.target.value)}>
          <option value="full">Any undrafted NFL player</option>
          <option value="roster_plus_rookies">Keeper league — my roster + rookies only</option>
        </select>
      </label>
      <p className="chart-note hub-draft-pool-hint">
        Keeper mode hides rostered players from the pool.
      </p>
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
