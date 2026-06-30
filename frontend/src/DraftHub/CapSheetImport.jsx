import React, { useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileBottomSheet from "../layout/MobileBottomSheet";

export default function CapSheetImport({ onImported, embedded = false }) {
  const mobileLayout = useMobileLayout();
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [syncSleeperFirst, setSyncSleeperFirst] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);

  const importSheet = async (file) => {
    if (!file) return;
    setImporting(true);
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const params = new URLSearchParams();
      if (syncSleeperFirst) {
        params.set("sync_sleeper_first", "true");
        params.set("contracts_only", "true");
        params.set("replace_existing", "false");
      } else {
        params.set("replace_existing", "true");
      }
      const res = await apiFetch(`/api/hub/cap-sheet/import?${params}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setResult(data);
      onImported?.();
    } catch (e) {
      setError(e.message || "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const triggerImport = () => {
    if (mobileLayout && !syncSleeperFirst) {
      setConfirmReplaceOpen(true);
      return;
    }
    fileRef.current?.click();
  };

  const confirmReplaceImport = () => {
    setConfirmReplaceOpen(false);
    fileRef.current?.click();
  };

  return (
    <section className={`panel hub-panel${embedded ? " hub-panel-embedded" : ""}${mobileLayout ? " hub-cap-import--mobile" : ""}`}>
      {!embedded && <h2>Cap sheet import</h2>}
      <p className="chart-note">
        Commissioner tab-separated cap sheet: manager, position, player, salary, contract years.
        Map manager abbreviations in <code>data/draft_hub/manager_team_map.yaml</code>.
      </p>
      <label className="admin-checkbox hub-cap-import-option">
        <input
          type="checkbox"
          checked={syncSleeperFirst}
          onChange={(e) => setSyncSleeperFirst(e.target.checked)}
        />
        Sync live Sleeper rosters first, then apply contracts from sheet (recommended)
      </label>
      {!syncSleeperFirst && (
        <p className="chart-note admin-muted">
          Replace mode wipes all league rosters and imports only what is in the file.
        </p>
      )}
      <div className={`hub-toolbar${mobileLayout ? " hub-toolbar--stack" : ""}`}>
        <input
          ref={fileRef}
          type="file"
          accept=".tsv,.txt,.tab"
          className="hub-file-input"
          onChange={(e) => importSheet(e.target.files?.[0])}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={importing}
          onClick={triggerImport}
        >
          {importing ? "Importing…" : "Upload cap sheet (TSV)"}
        </button>
      </div>
      <MobileBottomSheet
        open={confirmReplaceOpen}
        onClose={() => setConfirmReplaceOpen(false)}
        title="Replace all rosters?"
        className="app-mobile-sheet-confirm"
      >
        <p className="chart-note">
          Replace mode wipes all league rosters and imports only what is in the file. Continue?
        </p>
        <div className="hub-toolbar hub-toolbar--stack">
          <button type="button" className="btn-primary" onClick={confirmReplaceImport}>
            Yes, replace rosters
          </button>
          <button type="button" className="btn-ghost" onClick={() => setConfirmReplaceOpen(false)}>
            Cancel
          </button>
        </div>
      </MobileBottomSheet>
      {result && (
        <p className="chart-note">
          {result.mode === "sync_and_contracts" ? (
            <>
              {result.sleeper_sync?.message || "Sleeper synced."}
              {result.contract_overlay && (
                <>
                  {" "}
                  Contracts: {result.contract_overlay.updated ?? 0} updated,{" "}
                  {result.contract_overlay.added ?? 0} added
                  {(result.waived?.waived ?? 0) > 0
                    ? ` · ${result.waived.waived} waived (off Sleeper)`
                    : ""}
                </>
              )}
            </>
          ) : (
            <>
              Imported {result.imported} players
              {result.by_team && (
                <> · {Object.entries(result.by_team).map(([n, c]) => `${n}: ${c}`).join(", ")}</>
              )}
            </>
          )}
          {(result.unmatched?.length ?? 0) > 0 && ` · ${result.unmatched.length} unmatched names`}
          {(result.skipped_managers?.length ?? 0) > 0
            && ` · skipped managers: ${result.skipped_managers.join(", ")}`}
        </p>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
