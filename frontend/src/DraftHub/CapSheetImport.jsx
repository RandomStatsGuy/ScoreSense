import React, { useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileBottomSheet from "../layout/MobileBottomSheet";

function buildImportParams(syncSleeperFirst) {
  const params = new URLSearchParams();
  if (syncSleeperFirst) {
    params.set("sync_sleeper_first", "true");
    params.set("contracts_only", "true");
    params.set("replace_existing", "false");
  } else {
    params.set("replace_existing", "true");
  }
  return params;
}

export default function CapSheetImport({ onImported, embedded = false }) {
  const mobileLayout = useMobileLayout();
  const fileRef = useRef(null);
  const pendingFileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [syncSleeperFirst, setSyncSleeperFirst] = useState(true);
  const [validation, setValidation] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);

  const runImport = async (file) => {
    if (!file) return;
    setImporting(true);
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const params = buildImportParams(syncSleeperFirst);
      const res = await apiFetch(`/api/hub/cap-sheet/import?${params}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setResult(data);
      setValidation(null);
      pendingFileRef.current = null;
      onImported?.();
    } catch (e) {
      setError(e.message || "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const validateFile = async (file) => {
    if (!file) return;
    setValidating(true);
    setError("");
    setResult(null);
    setValidation(null);
    setConfirmWarnings(false);
    pendingFileRef.current = file;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const params = buildImportParams(syncSleeperFirst);
      const res = await apiFetch(`/api/hub/cap-sheet/validate?${params}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setValidation(data);
    } catch (e) {
      const msg = e.message || "Validation failed";
      setError(
        /field required/i.test(msg)
          ? "The file didn't reach the server. Use the .tsv from the repo (not Excel) and try again."
          : msg,
      );
      pendingFileRef.current = null;
    } finally {
      setValidating(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const triggerPick = () => {
    if (mobileLayout && !syncSleeperFirst) {
      setConfirmReplaceOpen(true);
      return;
    }
    fileRef.current?.click();
  };

  const confirmReplacePick = () => {
    setConfirmReplaceOpen(false);
    fileRef.current?.click();
  };

  const canImport = validation?.ok && (!validation.warnings?.length || confirmWarnings);

  return (
    <section className={`panel hub-panel${embedded ? " hub-panel-embedded" : ""}${mobileLayout ? " hub-cap-import--mobile" : ""}`}>
      {!embedded && <h2>Cap sheet import</h2>}
      <p className="chart-note">
        Commissioner tab-separated cap sheet: manager, position, player, salary, contract years.
        Use a <code>.tsv</code> (for example <code>data/draft_hub/cap_sheet_test.tsv</code>), not the Excel workbook.
      </p>
      <label className="admin-checkbox hub-cap-import-option">
        <input
          type="checkbox"
          checked={syncSleeperFirst}
          onChange={(e) => {
            setSyncSleeperFirst(e.target.checked);
            setValidation(null);
            pendingFileRef.current = null;
          }}
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
          onChange={(e) => validateFile(e.target.files?.[0])}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={validating || importing}
          onClick={triggerPick}
        >
          {validating ? "Validating…" : "Upload cap sheet (TSV)"}
        </button>
        {validation && canImport && (
          <button
            type="button"
            className="btn-ghost"
            disabled={importing}
            onClick={() => runImport(pendingFileRef.current)}
          >
            {importing ? "Importing…" : "Confirm import"}
          </button>
        )}
      </div>
      {validation && (
        <div className="hub-cap-validate-report" role="status">
          <p className="chart-note">
            {validation.stats?.matched ?? 0} players matched
            {validation.stats?.unmatched ? ` · ${validation.stats.unmatched} unmatched` : ""}
            {validation.stats?.duplicates ? ` · ${validation.stats.duplicates} duplicates` : ""}
            {validation.current_roster_count != null
              ? ` · ${validation.current_roster_count} roster slots today`
              : ""}
          </p>
          {(validation.errors || []).length > 0 && (
            <ul className="hub-cap-validate-errors">
              {validation.errors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          )}
          {(validation.warnings || []).length > 0 && (
            <>
              <ul className="hub-cap-validate-warnings">
                {validation.warnings.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
              {validation.ok && (
                <label className="admin-checkbox hub-cap-import-option">
                  <input
                    type="checkbox"
                    checked={confirmWarnings}
                    onChange={(e) => setConfirmWarnings(e.target.checked)}
                  />
                  I reviewed the warnings and want to proceed
                </label>
              )}
            </>
          )}
          {validation.ok && !(validation.warnings || []).length && (
            <p className="chart-note">Ready to import — click Confirm import.</p>
          )}
        </div>
      )}
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
          <button type="button" className="btn-primary" onClick={confirmReplacePick}>
            Yes, validate file
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
