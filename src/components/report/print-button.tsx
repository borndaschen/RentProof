"use client";

export function PrintReportButton() {
  return (
    <button
      className="primary-button report-print-button"
      type="button"
      onClick={() => window.print()}
    >
      列印或另存 PDF
    </button>
  );
}
