import React, { useEffect, useMemo, useRef, useState } from "react";

export default function TeamFilter({
  teams,
  selected,
  onChange,
  className = "",
  variant = "menu",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const isSheet = variant === "sheet";

  useEffect(() => {
    if (isSheet) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isSheet]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const toggle = (team) => {
    const set = new Set(selected);
    if (set.has(team)) set.delete(team);
    else set.add(team);
    onChange([...set].sort());
  };

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams || [];
    return (teams || []).filter((team) => String(team).toLowerCase().includes(q));
  }, [teams, query]);

  const label = selected.length === 0 ? "All teams" : `Teams (${selected.length})`;

  return (
    <div className={`team-filter${isSheet ? " team-filter--sheet" : ""}${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        type="button"
        className="header-context-control team-filter-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup={isSheet ? "dialog" : "listbox"}
      >
        {label}{isSheet ? (open ? " ▴" : " ▾") : " ▾"}
      </button>
      {open && (
        <div className={`team-filter-menu${isSheet ? " team-filter-menu--sheet" : ""}`} role={isSheet ? "dialog" : undefined} aria-label="Select teams">
          {isSheet ? (
            <label className="team-filter-search">
              <span className="sr-only">Search teams</span>
              <input
                type="search"
                className="search-input"
                placeholder="Search teams…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </label>
          ) : null}
          <div className="team-filter-menu-actions">
            <button
              type="button"
              className="team-filter-action"
              onClick={() => onChange([])}
            >
              Clear all
            </button>
            {isSheet ? (
              <button
                type="button"
                className="team-filter-action team-filter-action--done"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            ) : null}
          </div>
          <div className="team-filter-menu-list">
            {filteredTeams.length === 0 ? (
              <p className="team-filter-empty muted">No teams match.</p>
            ) : (
              filteredTeams.map((team) => (
                <label key={team} className="team-filter-item">
                  <input
                    type="checkbox"
                    checked={selected.includes(team)}
                    onChange={() => toggle(team)}
                  />
                  {team}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
