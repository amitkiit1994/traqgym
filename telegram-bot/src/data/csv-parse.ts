import Papa from "papaparse";

export type CsvCell = string | number | null;
export type CsvRow = Record<string, CsvCell>;

export interface ParseOptions {
  dateColumns?: string[];
  numberColumns?: string[];
}

export interface ParseResult {
  columns: string[];
  rows: CsvRow[];
}

const DDMMYYYY = /^(\d{2})-(\d{2})-(\d{4})$/;

function coerceDate(v: string): string | null {
  const m = v.trim().match(DDMMYYYY);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function coerceNumber(v: string): number | null {
  const stripped = v.replace(/,/g, "").trim();
  if (stripped === "") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

export function parseCsv(text: string, opts: ParseOptions = {}): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  });
  const columns = parsed.meta.fields ?? [];
  const dateCols = new Set(opts.dateColumns ?? []);
  const numCols = new Set(opts.numberColumns ?? []);
  const rows: CsvRow[] = parsed.data.map(raw => {
    const out: CsvRow = {};
    for (const col of columns) {
      const v = raw[col];
      if (v === undefined || v === "") { out[col] = null; continue; }
      if (dateCols.has(col)) { out[col] = coerceDate(v); continue; }
      if (numCols.has(col)) { out[col] = coerceNumber(v); continue; }
      out[col] = v;
    }
    return out;
  });
  return { columns, rows };
}
