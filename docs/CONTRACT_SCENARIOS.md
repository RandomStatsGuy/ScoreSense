# Draft Hub contract scenarios

How real-world roster situations map to **Contract type**, **Years left**, and Cap Planner badges.

Use this when importing a cap sheet, fixing mistagged players, or deciding extend vs FA.

---

## League model (defaults)

| Rule | Default |
|---|---|
| Rookie deal length | **2** seasons, **flat** salary |
| Vet deal length | **2** seasons, **+$5**/yr step-up |
| Extension | **One** extension of **1–3** years (default **2**), **+$5**/yr |
| Who can extend | Final-year **Rookie deal** or **Vet deal** |
| After an Extension ends | **Cannot extend again** → draft pool, then FA if undrafted |
| Max continuous ownership | Deal 2 + extension up to 3 ≈ **5** seasons |

Contracts expire **before** the next draft (keepers with 1 year left leave unless extended). Players you **just bought in this auction** are not treated as expiring keepers.

---

## The three UI fields that matter

### Contract type

| UI label | Meaning |
|---|---|
| **Rookie deal** | First fantasy deal for an NFL rookie window; years 1–2 stay flat; can take one extension in the final year |
| **Vet deal** | Not a rookie deal and not already an extension — steps +$5/yr every year; can take one extension in the final year |
| **Extension** | Already used the one extension — steps +$5/yr; when years hit 1 → draft pool, then FA if undrafted |

Auto-tagging (Sleeper sync / import) uses NFL experience (`years_exp` &lt; 2 → rookie). Commissioners can override; members can propose a type for commissioner approval.

### Years left

**Includes the upcoming season.** Years only drop by **1** when the commissioner marks **Draft done** (or ends the live draft).

| Moment | Example: 2-yr rookie signed at 2025 draft |
|---|---|
| After 2025 draft (deal just signed) | **2** |
| Pre-2026 draft (still have him for 2026) | still **2** |
| Mark draft complete → 2026 season year starts | **1** |
| Pre-2027 draft | **1** → extend or FA |

If a sheet shows `1` but you still have the player for the upcoming season on a 2-year deal, set years to **2**.

### Cap Planner badges (pre-draft only)

| Badge | When |
|---|---|
| **Extend to keep** | Final year **and** type is Rookie deal or Vet deal (eligible for one extension) |
| **Expiring** | Final year **and** type is Extension (already used the one extension), or extensions are off in Rules. They enter the draft pool; undrafted names become free agents after the draft. |
| _(none)_ | Years left ≥ 2, or just drafted this auction |

### Commissioner Drop vs Cut (Roster management)

| Action | Cap | Use |
|---|---|---|
| **Drop** | No dead cap. Leftover returns in full. | Staff removing a player so they can add them to another team. |
| **Cut** | Dead cap this season only at the league refund rate. Later years free in full. | A real cut, before or after the draft. |

---

## Scenario → what to set

### A. True rookie (NFL year 0–1), still on first fantasy deal

**Examples:** Just drafted last year; second year of a 2-year rookie deal still unpaid (pre-draft).

| Field | Set to |
|---|---|
| Contract type | **Rookie deal** |
| Years left | **2** if both upcoming + following season remain; **1** only if this draft is the last year of the deal |

**Cap Planner:** years = 2 → not on expire lists. years = 1 → **Extend to keep**.

---

### B. Rookie deal in its final year (must decide)

**Examples:** 2024 draft class on a 2-year deal, pre-2026 draft, clock already shows 1 year.

| Field | Set to |
|---|---|
| Contract type | **Rookie deal** |
| Years left | **1** |

**Action:** Cap Planner → **Extend** (1–3 years, step-up applies) **or** let them enter the draft pool.

Do **not** set type to Extension here — that removes extend eligibility. A Vet deal can still extend.

---

### C. Already extended once

**Examples:** Former rookie you extended last offseason for 2–3 years.

| Field | Set to |
|---|---|
| Contract type | **Extension** |
| Years left | Remaining seasons **including** the upcoming one |

**Cap Planner:** when years = 1 → **Expiring** (cannot extend again). They enter the draft pool; undrafted names become free agents after the draft.

---

### D. Veteran / waiver / trade pickup (never on your rookie deal)

**Examples:** Multi-year vet you bought in auction; FA signed mid-season; traded-in player already past rookie window.

| Field | Set to |
|---|---|
| Contract type | **Vet deal** (or **Extension** only if they were already extended in *your* league) |
| Years left | Whatever their current deal still covers (often **2** for a new auction buy) |

**Cap Planner:** years = 1 on a Vet deal → **Extend to keep**. years = 1 on an Extension → **Expiring**.

---

### E. Just won in this year’s auction

**Examples:** Nominated and awarded in the live room / mock.

Auction terms are assigned automatically. Owners do **not** pick years after the sale.

| Field | Set to |
|---|---|
| Contract type | **Rookie deal** if NFL rookie class; else **Vet deal** |
| Years left | **2** |
| Salary | Sale price in year 1. Rookies stay flat; veterans step +$5/yr (league setting) |
| Source | System tags `draft` / `auction` |

Year control is only the **pre-draft extension** window (add 1–3 years, default 2, with step-ups).

**Cap Planner:** Brand-new auction buys are this year’s acquisition, not “expire before draft.”

---

### F. Cut (keep dead cap this season only)

**Examples:** Dropping a keeper to free auction budget; cutting a multi-year deal after the draft.

| UI action | Result |
|---|---|
| **Cut** on My team or Roster management | Player leaves committed cap; dead cap = (1 − cut refund %) of this season only. Later years free in full. |
| Undo cut | Restores active status |

Type/years stay on the row for dead-cap math; they are not FA you can re-buy under the same deal.

**Leftover on Cap, Rosters, and My team is auction leftover.** A 1-year keeper who expires at the draft does not count as committed. Dead cap from a cut still subtracts from leftover this season only.

---

### G. Cap sheet import looks wrong

| Sheet reality | Fix in UI |
|---|---|
| Player is a second-year NFL player on a 2-yr fantasy rookie deal, sheet shows 1 year | Type **Rookie deal**, years **2** (pre-draft) |
| Multi-year stepped salaries (15 / 20 / 25) | Usually **Extension** or **Vet deal**; years = number of salary columns left |
| One year, long-time NFL vet | **Vet deal**, years **1** (Extend to keep) unless already an **Extension** |
| Import forced everyone to Vet deal | Manually set Rookie deal where NFL exp &lt; 2, or Sync Sleeper to re-infer |

---

### H. Member vs commissioner edits

| Who | Type change |
|---|---|
| Commissioner / solo | Applies immediately (marked manual so sync won’t overwrite) |
| League member | Queues **Pending** → commissioner Approves/Rejects in Setup |

Salary / years edits stay commissioner-only in shared leagues.

---

## Decision flowchart (pre-draft)

```text
Is years left ≥ 2?
  YES → Retained; nothing to do for expire/extend
  NO (years = 1, not a brand-new draft buy):
      Type = Rookie deal or Vet deal (and Rules allow extensions)?
        YES → Cap Planner: Extend to keep (or draft pool)
        NO  → Cap Planner: Expiring (already an Extension, or extensions off; draft pool, then FA if undrafted)
```

---

## Year clock checklist

1. Pre-draft: years **include** the season you’re about to play.
2. Run the auction / draft.
3. Commissioner marks **Draft done** (confirm dialog).
4. Every active contract **−1 year**; anyone at 0 is removed as FA.
5. When the league planning season advances (e.g. 2025 → 2026), Hub reopens **pre-draft** mode but **keeps** those ticked years — it does not reset everyone back to 2.
6. Next offseason, use Cap Planner again on whoever is now at 1 year.

---

## Quick reference: TreVeyon Henderson–style case

- NFL: drafted 2025, still in year-1/2 window.
- Fantasy: 2-year rookie deal covering 2025 + 2026.
- **Pre-2025 draft (just signed):** Type = **Rookie deal**, Years = **2**.
- After 2025 draft marked complete: Years → **1**.
- **Planning season advanced to 2026 (pre-draft):** Years stay **1** → **Extend to keep** or FA.
- Sync / backfill must not push a correctly typed rookie back to 2 after the year clock has ticked.

---

## Related code (for agents)

| Concern | Path |
|---|---|
| Extend eligibility | `src/draft_hub/contracts.py` → `can_renew` |
| Expire before draft | `src/draft_hub/pre_draft_cap.py` |
| Year tick on draft complete | `src/draft_hub/contract_year_clock.py` |
| Type inference | `src/draft_hub/contract_typing.py` |
| Type API | `POST /api/hub/roster/contract-type` |
