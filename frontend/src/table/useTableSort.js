import { useState } from "react";

/**
 * Column sort state shared by projection tables.
 * Clicking a new column sorts descending; clicking the active column flips direction.
 */
export function useTableSort(initial) {
  const [sort, setSort] = useState(initial);
  const toggleSort = (column) =>
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "desc" },
    );
  return [sort, toggleSort];
}
