import { useMemo } from "react";

/** Stable identity for a table row across sorts/filters. */
export function rowRankKey(row) {
  return `${row.player_id || row.Player}-${row.Team}`;
}

/**
 * Position rank per row, computed over the FULL slate (before search/team
 * filters) so a player's rank is stable no matter how the table is sorted or
 * filtered. Rows where `metric` returns a non-finite value are unranked.
 *
 * Returns a Map of rowRankKey(row) -> 1-based rank.
 */
export function useRankMap(rows, metric) {
  return useMemo(() => {
    const ranked = [];
    for (const row of rows || []) {
      const value = Number(metric(row));
      if (Number.isFinite(value)) ranked.push([rowRankKey(row), value]);
    }
    ranked.sort((a, b) => b[1] - a[1]);
    const map = new Map();
    ranked.forEach(([key], index) => map.set(key, index + 1));
    return map;
  }, [rows, metric]);
}
