import Papa from "papaparse";

export type CsvCell = string | number | null;
export type CsvRow = Record<string, CsvCell>;

export interface ParseOptions {
  dateColumns?: string[];
  numberColumns?: string[];
}

export interface ColumnDiagnostic {
  parsed_count: number;
  null_count: number;
  parse_failed_count: number;
  sample_bad_values: string[];
}

export interface ParseResult {
  columns: string[];
  rows: CsvRow[];
  parse_errors: string[];
  column_diagnostics: Record<string, ColumnDiagnostic>;
}

const DDMMYYYY = /^(\d{2})-(\d{2})-(\d{4})$/;
const YYYYMMDD = /^(\d{4})-(\d{2})-(\d{2})$/;
// "Created On" on EGYM's payments CSV is the only column FB serializes
// with month names + millis (e.g. "19 May 2025 21:33:15:287"); everything
// else is DD-MM-YYYY. Capture the day + 3-letter month + year and ignore
// the time portion.
const D_MMM_YYYY = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/;
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
const NULL_LITERALS = new Set([
  "na", "n/a", "n.a.", "n.a", "--", "-", "—", "none", "null", "nil", "nan",
]);
const CURRENCY_GLYPHS = /[₹$€£¥]/g;

function coerceDate(v: string): string | null {
  const trimmed = v.trim();
  if (trimmed === "") return null;

  // "19 May 2025 21:33:15:287" — month name form (must match against the
  // full trimmed string because the month token contains spaces and would
  // be lost by splitting on whitespace).
  const named = trimmed.match(D_MMM_YYYY);
  if (named) {
    const [, d, monStr, yyyy] = named;
    const mm = MONTHS[monStr!.slice(0, 3).toLowerCase()];
    if (mm) return `${yyyy}-${mm}-${d!.padStart(2, "0")}`;
  }

  // Numeric forms: tolerate trailing time, then match DD-MM-YYYY or ISO.
  const head = trimmed.split(/[\sT]/)[0] ?? trimmed;
  const ddmm = head.match(DDMMYYYY);
  if (ddmm) {
    const [, dd, mm, yyyy] = ddmm;
    return `${yyyy}-${mm}-${dd}`;
  }
  const iso = head.match(YYYYMMDD);
  if (iso) return head;
  return null;
}

function coerceNumber(v: string): number | null {
  let s = v.trim();
  if (s === "" || NULL_LITERALS.has(s.toLowerCase())) return null;
  s = s.replace(CURRENCY_GLYPHS, "").replace(/,/g, "");
  s = s.replace(/^Rs\.?\s*/i, "").replace(/\s*(INR|USD|EUR|GBP)$/i, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bumpDiag(
  diag: ColumnDiagnostic,
  outcome: "parsed" | "null_blank" | "parse_failed",
  raw?: string,
) {
  if (outcome === "parsed") diag.parsed_count++;
  else {
    diag.null_count++;
    if (outcome === "parse_failed") {
      diag.parse_failed_count++;
      if (raw && diag.sample_bad_values.length < 3) diag.sample_bad_values.push(raw);
    }
  }
}

export function parseCsv(text: string, opts: ParseOptions = {}): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  });
  const columns = parsed.meta.fields ?? [];
  const dateCols = new Set(opts.dateColumns ?? []);
  const numCols = new Set(opts.numberColumns ?? []);

  const diags: Record<string, ColumnDiagnostic> = {};
  for (const col of columns) {
    if (dateCols.has(col) || numCols.has(col)) {
      diags[col] = { parsed_count: 0, null_count: 0, parse_failed_count: 0, sample_bad_values: [] };
    }
  }

  const rows: CsvRow[] = parsed.data.map(raw => {
    const out: CsvRow = {};
    for (const col of columns) {
      const v = raw[col];
      const isBlank = v === undefined || v === "";
      if (isBlank) {
        out[col] = null;
        if (diags[col]) bumpDiag(diags[col], "null_blank");
        continue;
      }
      if (dateCols.has(col)) {
        const coerced = coerceDate(v);
        out[col] = coerced;
        bumpDiag(diags[col]!, coerced === null ? "parse_failed" : "parsed", v);
        continue;
      }
      if (numCols.has(col)) {
        const coerced = coerceNumber(v);
        out[col] = coerced;
        bumpDiag(diags[col]!, coerced === null ? "parse_failed" : "parsed", v);
        continue;
      }
      out[col] = v;
    }
    return out;
  });

  // Keep structural Papa errors (delimiter/quote issues that shift columns
  // into the wrong fields). Filter out "TooFewFields"/"TooManyFields" which
  // are common on real-world FB exports and not actionable.
  const parse_errors = (parsed.errors ?? [])
    .filter(e => e.type === "Delimiter" || e.type === "Quotes")
    .map(e => `${e.type}/${e.code} @row ${e.row ?? "?"}: ${e.message}`)
    .slice(0, 5);

  return { columns, rows, parse_errors, column_diagnostics: diags };
}

// Returns columns whose parse-failure rate exceeds the threshold (default 5%).
// Used by query-csv / list-csvs to flag misaligned parsers loudly instead of
// silently returning ₹0.
export function unhealthyColumns(
  diags: Record<string, ColumnDiagnostic>,
  threshold = 0.05,
): string[] {
  const bad: string[] = [];
  for (const [col, d] of Object.entries(diags)) {
    const total = d.parsed_count + d.parse_failed_count;
    if (total > 0 && d.parse_failed_count / total > threshold) bad.push(col);
  }
  return bad;
}
