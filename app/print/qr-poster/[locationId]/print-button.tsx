"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      className="qr-poster-btn"
      onClick={() => window.print()}
    >
      Print / Save as PDF
    </button>
  );
}
