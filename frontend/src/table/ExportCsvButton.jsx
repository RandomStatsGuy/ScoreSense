import React from "react";

export function DownloadIcon() {
  return (
    <svg className="export-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ExportCsvButton({ onExport, disabled }) {
  return (
    <button
      type="button"
      className="btn-export-csv"
      onClick={onExport}
      disabled={disabled}
      title="Download filtered table as CSV"
    >
      <DownloadIcon />
      Export CSV
    </button>
  );
}
