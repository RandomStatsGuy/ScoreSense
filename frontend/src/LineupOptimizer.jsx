import React from "react";
import useDfsBuilder from "./useDfsBuilder";
import DfsWorkspace from "./DfsWorkspace";
import DfsResults from "./DfsResults.jsx";
import {
  DFS_WORKSPACE_COPY as C,
  DFS_RESULTS_COPY as R,
  DFS_FLOW_COPY as F,
} from "./dfsToolPresentation";
import "./styles/dfs-workspace.css";

export default function LineupOptimizer({ projMeta }) {
  const builder = useDfsBuilder(projMeta);
  const view = builder.workspaceUi.view;
  const setView = value => builder.changeWorkspaceUi("view", value);
  return (
    <div className="dfw">
      <header className="dfw-title">
        <div><h1>{view === "build" ? F.title : R.title}</h1>
        {view === "results" && <p>{R.support}</p>}</div>
        <button type="button" onClick={() => setView(view === "build" ? "results" : "build")}>{view === "build" ? C.results : C.build}</button>
      </header>
      {view === "build" ? (
        <>
          {builder.dataUpdateAvailable && (
            <div className="dfw-notice" role="status">
              {builder.context.source === "live" ? C.dataUpdate : C.uploadedUpdate}
              {builder.context.source === "live" && (
                <button type="button" className="btn-ghost" disabled={builder.busy || builder.building} onClick={builder.reloadPlayerPool}>
                  {C.updatePool}
                </button>
              )}
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
