import React, { useState } from "react";
import useDfsBuilder from "./useDfsBuilder";
import DfsWorkspace from "./DfsWorkspace";
import DfsResults from "./DfsResults.jsx";
import {
  DFS_WORKSPACE_COPY as C,
  DFS_RESULTS_COPY as R,
} from "./dfsToolPresentation";
import "./styles/dfs-workspace.css";

export default function LineupOptimizer({ projMeta }) {
  const builder = useDfsBuilder(projMeta);
  const [view, setView] = useState("build");
  return (
    <div className="dfw">
      <header className="dfw-title">
        <small>{C.eyebrow}</small>
        <h1>{view === "build" ? C.title : R.title}</h1>
        <p>{view === "build" ? C.support : R.support}</p>
      </header>
      <nav className="dfw-tabs" aria-label="DFS workspace">
        <button
          aria-current={view === "build" ? "page" : undefined}
          onClick={() => setView("build")}
        >
          {C.build}
        </button>
        <button
          aria-current={view === "results" ? "page" : undefined}
          onClick={() => setView("results")}
        >
          {C.results}
        </button>
      </nav>
      {view === "build" ? (
        <>
          {builder.error && (
            <div className="dfw-error" role="alert">
              {builder.error}
            </div>
          )}
          {builder.notice && (
            <div className="dfw-notice" role="status">
              {builder.notice}
            </div>
          )}
          <DfsWorkspace b={builder} />
        </>
      ) : (
        <DfsResults />
      )}
    </div>
  );
}
