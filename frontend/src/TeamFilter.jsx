import React, { useEffect, useRef, useState } from "react";

export default function TeamFilter({ teams, selected, onChange, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (team) => {
    const set = new Set(selected);
    if (set.has(team)) set.delete(team);
    else set.add(team);
    onChange([...set].sort());
  };

  const label =
    selected.length === 0
      ? "All teams"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} teams`;

  return (
    <div className={`team-filter${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        type="button"
        className="header-context-control team-filter-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {label} ▾
      </button>
      {open && (
        <div className="team-filter-menu">
          <button
            type="button"
            className="team-filter-action"
            onClick={() => onChange([])}
          >
            Clear all
          </button>
          {(teams || []).map((team) => (
            <label key={team} className="team-filter-item">
              <input
                type="checkbox"
                checked={selected.includes(team)}
                onChange={() => toggle(team)}
              />
              {team}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
