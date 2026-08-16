import { useState } from "react";

/**
 * Column sort state shared by projection tables.
 * Clicking a new column sorts descending; clicking the active column flips direction.
 * Pass `{ forceDir }` to set an absolute direction (SCORE-7 movers filter).
 */
export function useTableSort(initial) {
  const [sort, setSort] = useState(initial);
  const toggleSort = (column, opts = null) =>
    setSort((prev) => {
      if (opts?.forceDir) {
        return { column, dir: opts.forceDir };
      }
      return prev.column === column
        ? { column, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "desc" };
    });
  return [sort, toggleSort];
}
