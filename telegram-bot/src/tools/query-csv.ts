import type { CsvRow, CsvCell } from "../data/csv-parse.js";

export type FilterOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "between" | "in" | "icontains" | "isblank" | "notblank";

export type Filter =
  | { col: string; op: Exclude<FilterOp, "between" | "in" | "isblank" | "notblank">; val: CsvCell }
  | { col: string; op: "between"; val: [CsvCell, CsvCell] }
  | { col: string; op: "in"; val: CsvCell[] }
  | { col: string; op: "isblank" | "notblank"; val?: undefined };

export type AggFn = "sum" | "count" | "avg" | "min" | "max";

export interface QueryArgs {
  filters?: Filter[];
  group_by?: string[];
  agg?: { col: string; fn: AggFn };
  select?: string[];
  order_by?: { col: string; dir: "asc" | "desc" };
  limit?: number;
}

export interface QueryResult {
  rows: CsvRow[];
  row_count: number;
  truncated: boolean;
  agg_result?: number | Record<string, number>;
  error?: string;
  hint?: string;
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const VALID_OPS: ReadonlySet<string> = new Set([
  "eq","neq","gt","gte","lt","lte","between","in","icontains","isblank","notblank",
]);
const VALID_FNS: ReadonlySet<string> = new Set(["sum","count","avg","min","max"]);

function err(msg: string, hint?: string): QueryResult {
  return { rows: [], row_count: 0, truncated: false, error: msg, hint };
}

function asNum(v: CsvCell): number | null {
  if (typeof v === "number") return v;
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function cmp(a: CsvCell, b: CsvCell): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function matchFilter(row: CsvRow, f: Filter): boolean {
  const v = row[f.col] ?? null;
  switch (f.op) {
    case "eq":  return cmp(v, f.val as CsvCell) === 0;
    case "neq": return cmp(v, f.val as CsvCell) !== 0;
    case "gt":  return cmp(v, f.val as CsvCell) > 0;
    case "gte": return cmp(v, f.val as CsvCell) >= 0;
    case "lt":  return cmp(v, f.val as CsvCell) < 0;
    case "lte": return cmp(v, f.val as CsvCell) <= 0;
    case "between": {
      const [lo, hi] = f.val;
      return cmp(v, lo) >= 0 && cmp(v, hi) <= 0;
    }
    case "in":
      return f.val.some(x => cmp(v, x) === 0);
    case "icontains":
      return v != null && String(v).toLowerCase().includes(String(f.val).toLowerCase());
    case "isblank":  return v == null || v === "";
    case "notblank": return !(v == null || v === "");
  }
}

export function applyQuery(rows: CsvRow[], args: QueryArgs): QueryResult {
  const columns = new Set(rows.length > 0 ? Object.keys(rows[0]!) : []);

  for (const f of args.filters ?? []) {
    if (!VALID_OPS.has(f.op)) {
      return err(`Unknown op: ${f.op}`, `Valid ops: ${[...VALID_OPS].join(", ")}`);
    }
    if (rows.length > 0 && !columns.has(f.col)) {
      return err(`Unknown column: ${f.col}`, `Available: ${[...columns].join(", ")}`);
    }
  }
  if (args.agg && !VALID_FNS.has(args.agg.fn)) {
    return err(`Unknown agg fn: ${args.agg.fn}`, `Valid: ${[...VALID_FNS].join(", ")}`);
  }
  if (args.agg && rows.length > 0 && !columns.has(args.agg.col)) {
    return err(`Unknown agg column: ${args.agg.col}`);
  }
  for (const c of args.group_by ?? []) {
    if (rows.length > 0 && !columns.has(c)) {
      return err(`Unknown group_by column: ${c}`);
    }
  }

  let filtered = rows;
  for (const f of args.filters ?? []) {
    filtered = filtered.filter(r => matchFilter(r, f));
  }

  if (args.agg) {
    const { col, fn } = args.agg;
    if (args.group_by && args.group_by.length > 0) {
      const grouped: Record<string, CsvRow[]> = {};
      const keys = args.group_by;
      for (const r of filtered) {
        const key = keys.map(k => String(r[k] ?? "")).join(" | ");
        (grouped[key] ??= []).push(r);
      }
      const aggResult: Record<string, number> = {};
      for (const [k, group] of Object.entries(grouped)) {
        aggResult[k] = aggregateOver(group, col, fn);
      }
      return { rows: [], row_count: filtered.length, truncated: false, agg_result: aggResult };
    }
    return {
      rows: [],
      row_count: filtered.length,
      truncated: false,
      agg_result: aggregateOver(filtered, col, fn),
    };
  }

  if (args.order_by) {
    const { col, dir } = args.order_by;
    if (rows.length > 0 && !columns.has(col)) {
      return err(`Unknown order_by column: ${col}`);
    }
    const sign = dir === "desc" ? -1 : 1;
    filtered = [...filtered].sort((a, b) => sign * cmp(a[col] ?? null, b[col] ?? null));
  }

  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const truncated = filtered.length > limit;
  let outRows = filtered.slice(0, limit);

  if (args.select && args.select.length > 0) {
    const sel = args.select;
    outRows = outRows.map(r => {
      const o: CsvRow = {};
      for (const c of sel) o[c] = r[c] ?? null;
      return o;
    });
  }

  return { rows: outRows, row_count: outRows.length, truncated };
}

function aggregateOver(rows: CsvRow[], col: string, fn: AggFn): number {
  if (fn === "count") return rows.length;
  const nums = rows
    .map(r => asNum(r[col] ?? null))
    .filter((n): n is number => n != null);
  if (nums.length === 0) return 0;
  switch (fn) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return Math.min(...nums);
    case "max": return Math.max(...nums);
  }
}
