# Projection tier benchmarks

Reviewed October 14, 2026. These are ScoreSense display bands calibrated to **outside 2026 full-PPR projections**, not published industry tier labels and not thresholds fitted to our current forecasts. Empty S tiers remain possible. No player is promoted just to fill a tier.

## Outside reference points

FantasyPros' September 8 preseason consensus projects these season PPR totals:

| Position | Reference player | Season PPR | Season total ÷ 17 |
| --- | --- | ---: | ---: |
| QB | Josh Allen | 367.1 | 21.59 |
| RB | Jahmyr Gibbs | 370.4 | 21.79 |
| RB | Bijan Robinson | 353.2 | 20.78 |
| WR | Puka Nacua | 338.3 | 19.90 |
| WR | Ja'Marr Chase | 338.3 | 19.90 |
| TE | Trey McBride | 260.4 | 15.32 |
| TE | Brock Bowers | 239.4 | 14.08 |

Sources: [QB](https://www.fantasypros.com/nfl/projections/qb.php?week=draft&scoring=PPR), [RB](https://www.fantasypros.com/nfl/projections/rb.php?week=draft&scoring=PPR), [WR](https://www.fantasypros.com/nfl/projections/wr.php?week=draft&scoring=PPR), [TE](https://www.fantasypros.com/nfl/projections/te.php?week=draft&scoring=PPR). Divide by 17 as a season scoring pace, not an estimate of points in games actually played. The PPR query/title and reception-inclusive stat totals establish the scoring format; the site's generic scoring footer is not used to identify PPR.

[ESPN's September 9 projection guide](https://g.espncdn.com/s/ffldraftkit/26/NFLDK2026_CS_ClayProjections2026.pdf) independently lists 17-game PPR totals: Allen 370 (PDF page 35), Gibbs 369 and Robinson 352 (page 36), Nacua 354 and Chase 337 (page 39). These agree on elite QB/RB pace near 21–22 and WR pace near 20–21. ESPN RB starter/depth examples include Cook 281, Etienne 246, Montgomery 200, and Spears 154 on page 36. They informed rounded lower-band boundaries; the boundaries are our design judgment, not exact rank quotas. Availability assumptions differ across providers, so these are broad scoring anchors rather than a claim that their per-game or injury treatment is identical to ours.

## Fixed weekly / per-game PPR bands

| Position | S ≥ | A ≥ | B ≥ | C ≥ | D | F |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| QB | 21 | 18 | 15 | 12 | >6 to <12 | ≤6 |
| RB | 20 | 16 | 12 | 9 | >6 to <9 | ≤6 |
| WR | 19 | 15 | 12 | 9 | >6 to <9 | ≤6 |
| TE | 14 | 11 | 9 | 7.5 | >6 to <7.5 | ≤6 |

A, B, and C end just below the next higher tier's threshold. S is unbounded above; F is unbounded below. Weekly uses that week's P50. Live ROS uses only ROS points / known positive remaining games, and recorded season views use recorded points / known positive games played; neither uses the current week's forecast to classify season data. These fixed strength benchmarks are not week-specific expert ranking tiers.

## Fixed full-season PPR bands

| Position | S ≥ | A ≥ | B ≥ | C ≥ | D | F |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| QB | 350 | 300 | 250 | 200 | >100 to <200 | ≤100 |
| RB | 340 | 270 | 205 | 150 | >100 to <150 | ≤100 |
| WR | 320 | 255 | 205 | 150 | >100 to <150 | ≤100 |
| TE | 240 | 190 | 150 | 125 | >100 to <125 | ≤100 |

Full-season tiers read the same projected season P50 total shown in the row, including schedule/availability adjustments. They do not read weekly points or `Per-Game Proj`. Annual thresholds are independently rounded against the published totals above, not a demand that every season threshold equal its weekly counterpart ×17. The annual F boundary is a round depth threshold, approximately six points over 17 games.

## Inclusion and maintenance

Every filtered input occurrence stays in exactly one group. All finite zero/negative values stay in F when position is known; missing points, unsupported positions, and unknown WR/TE identities stay visible as Untiered. QB/RB board context can supply a missing single-position identity; the combined `wr` board/model key cannot identify an individual as WR. Use the row's actual `Position` / `position` to distinguish WR and TE. The projections UI now offers separate WR and TE filters; the `wr` API/model artifact remains shared. Unknown receiver identities remain visible as Untiered in either receiver view without claiming a position rank or leader signal. Explicit weekly bye players stay in On bye with forecasts/ranks/leader signals/compare additions suppressed; never infer byes from missing opponents. Inactive and left-slate groups retain their existing ownership. Older ROS artifacts gain actual WR/TE identity through the existing serve-time roster overlay, and fresh aggregation preserves it. Unknown identities remain unknown; forecast values and on-disk artifacts are unchanged. No rank or per-tier player cap is added, and CSV exports still contain all filtered rows.

Thresholds are a reviewed, versioned snapshot in `frontend/src/projectionTiers.js`. No live external fetch or current-slate normalization changes them. Recheck published season, scoring, games, and update date when refreshing this reference. Do not silently reuse this PPR calibration for Standard scoring or call it a real-time industry consensus.

Standard/PPR switching is an explicitly deferred follow-up. Current forecasts supply PPR point quantiles, not projected reception stat lines; adding a truthful Standard forecast requires supported scoring outputs and validation rather than relabeling PPR numbers.
