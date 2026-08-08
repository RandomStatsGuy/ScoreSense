# Draft Hub contract scenarios

How real-world roster situations map to **Contract type**, **Years left**, and Cap Planner badges.

Use this when importing a cap sheet, fixing mistagged players, or deciding extend vs FA.

---

## League model (defaults)

| Rule | Default |
|---|---|
| Rookie deal length | **2** seasons |
| Post-rookie extension | **One** extension of **1–3** years |
| Extension step-up | **+$5**/yr (league setting) |
| Veterans after their deal | **Cannot re-sign** → free agency |
| After an extension ends | **Cannot re-sign** → free agency |
| Max continuous ownership | Rookie 2 + extension up to 3 ≈ **5** seasons |

Contracts expire **before** the next draft (keepers with 1 year left leave unless extended). Players you **just bought in this auction** are not treated as expiring keepers.

---

## The three UI fields that matter

### Contract type

| UI label | Meaning |
|---|---|
| **Rookie deal** | Still on the initial 2-year rookie contract; can extend once in the final year |
| **Veteran** | Not a rookie deal / not an extension — final year → FA (no re-sign) |
| **Extension** | Already used the one post-rookie extension — when years hit 1 → FA |

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
| **Extend to keep** | Final year **and** type is Rookie deal (eligible for one extension) |
| **Expires — FA** | Final year **and** Veteran or Extension (cannot re-sign) |
| _(none)_ | Years left ≥ 2, or just drafted this auction |

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

**Action:** Cap Planner → **Extend** (1–3 years, step-up applies) **or** let them hit FA.

Do **not** set type to Veteran here — that removes extend eligibility.

---

### C. Already extended once

**Examples:** Former rookie you extended last offseason for 2–3 years.

| Field | Set to |
|---|---|
| Contract type | **Extension** |
| Years left | Remaining seasons **including** the upcoming one |

**Cap Planner:** when years = 1 → **Expires — FA** (cannot extend again).

---

### D. Veteran / waiver / trade pickup (never on your rookie deal)

**Examples:** Multi-year vet you bought in auction; FA signed mid-season; traded-in player already past rookie window.

| Field | Set to |
|---|---|
| Contract type | **Veteran** (or **Extension** only if they were already extended in *your* league) |
| Years left | Whatever their current deal still covers (often **1**) |

**Cap Planner:** years = 1 → **Expires — FA**. You cannot re-sign them after expiry.

---

### E. Just won in this year’s auction

**Examples:** Nominated and awarded in the live room / mock.

| Field | Set to |
|---|---|
| Contract type | Usually **Rookie deal** if NFL rookie class; else **Veteran** |
| Years left | Deal length you drafted (often **1** for vets, **2** for rookies) |
| Source | System tags `draft` / `auction` |

**Cap Planner:** Even with years = 1, **not** treated as “expire before draft” for *this* draft — they are this year’s acquisition.

---

### F. Cut before draft (keep dead cap)

**Examples:** Dropping a keeper to free auction budget; accepting dead money.

| UI action | Result |
|---|---|
| **Cut pre-draft** on Roster | Player leaves committed cap; dead cap = (1 − cut refund %) of remaining years |
| Undo cut | Restores active status |

Type/years stay on the row for dead-cap math; they are not FA you can re-buy under the same deal.

---

### G. Cap sheet import looks wrong

| Sheet reality | Fix in UI |
|---|---|
| Player is a second-year NFL player on a 2-yr fantasy rookie deal, sheet shows 1 year | Type **Rookie deal**, years **2** (pre-draft) |
| Multi-year stepped salaries (15 / 20 / 25) | Usually **Extension**; years = number of salary columns left |
| One year, long-time NFL vet | **Veteran**, years **1** |
| Import forced everyone to Veteran | Manually set Rookie deal where NFL exp &lt; 2, or Sync Sleeper to re-infer |

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
      Type = Rookie deal?
        YES → Cap Planner: Extend to keep (or FA)
        NO  → Cap Planner: Expires — FA (cannot re-sign)
```

---

## Year clock checklist

1. Pre-draft: years **include** the season you’re about to play.
2. Run the auction / draft.
3. Commissioner marks **Draft done** (confirm dialog).
4. Every active contract **−1 year**; anyone at 0 is removed as FA.
5. Next offseason, use Cap Planner again on whoever is now at 1 year.

---

## Quick reference: TreVeyon Henderson–style case

- NFL: drafted 2025, still in year-1/2 window.
- Fantasy: 2-year rookie deal covering 2025 + 2026.
- **Pre-2026 draft:** Type = **Rookie deal**, Years = **2**.
- Not on Extend / FA lists.
- After draft marked complete: Years → **1**.
- Pre-2027 draft: Years = **1** → **Extend to keep** or FA.

---

## Related code (for agents)

| Concern | Path |
|---|---|
| Extend eligibility | `src/draft_hub/contracts.py` → `can_renew` |
| Expire before draft | `src/draft_hub/pre_draft_cap.py` |
| Year tick on draft complete | `src/draft_hub/contract_year_clock.py` |
| Type inference | `src/draft_hub/contract_typing.py` |
| Type API | `POST /api/hub/roster/contract-type` |
