# Telegram Talk-to-Data Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot at `freeformfitnessOS/telegram-bot/` that lets allowlisted users (Amit + Robin) ask natural-language questions about FreeForm Fitness gym data and get answers grounded in daily FitnessBoard CSV exports.

**Architecture:** Standalone Vercel project (TypeScript, Node 20 runtime) that exposes `/api/webhook` for Telegram. Uses OpenAI GPT-4o-mini with a bounded `query_csv` DSL tool to query 8 CSVs stored in Vercel Blob. Daily refresh via GitHub Actions cron that runs the existing `fetch_complete.py` scraper and uploads CSVs to Blob.

**Tech Stack:** TypeScript, Node 20, Vercel Functions, OpenAI SDK, @vercel/blob, papaparse, zod, vitest, python-3.11 (cron only).

**Spec:** `docs/specs/2026-05-16-telegram-data-bot-design.md`

---

## Task 1: Scaffold telegram-bot project

**Files:**
- Create: `telegram-bot/package.json`
- Create: `telegram-bot/tsconfig.json`
- Create: `telegram-bot/vitest.config.ts`
- Create: `telegram-bot/vercel.json`
- Create: `telegram-bot/.gitignore`
- Create: `telegram-bot/.env.example`
- Create: `telegram-bot/README.md`

- [ ] **Step 1: Create `telegram-bot/package.json`**

```json
{
  "name": "freeform-telegram-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": "20.x" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "register-webhook": "node scripts/register-webhook.mjs"
  },
  "dependencies": {
    "@vercel/blob": "^0.27.0",
    "openai": "^5.0.0",
    "papaparse": "^5.4.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/papaparse": "^5.3.14",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `telegram-bot/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["api/**/*", "src/**/*", "scripts/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create `telegram-bot/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `telegram-bot/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "api/webhook.ts": {
      "runtime": "@vercel/node@5",
      "maxDuration": 30
    }
  }
}
```

- [ ] **Step 5: Create `telegram-bot/.gitignore`**

```
node_modules
.vercel
.env
.env.local
*.log
coverage
```

- [ ] **Step 6: Create `telegram-bot/.env.example`**

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_CHAT_IDS=
WEBHOOK_SECRET=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
BLOB_READ_WRITE_TOKEN=
GITHUB_PAT=
GITHUB_REPO=amitkumardas/freeformfitnessOS
LOG_LEVEL=info
```

- [ ] **Step 7: Create `telegram-bot/README.md`** (stub — full deploy steps added in Task 18)

```markdown
# FreeForm Telegram Bot

Talk-to-data bot for FreeForm Fitness gym. See `docs/specs/2026-05-16-telegram-data-bot-design.md` for design and `docs/plans/2026-05-16-telegram-data-bot.md` for build status.

Setup instructions added in final task.
```

- [ ] **Step 8: Install dependencies**

Run from `telegram-bot/`: `npm install`
Expected: lockfile created, no errors.

- [ ] **Step 9: Verify typecheck baseline**

Run: `cd telegram-bot && npm run typecheck`
Expected: PASS (no source files yet, so noop).

- [ ] **Step 10: Commit**

```bash
git add telegram-bot/
git commit -m "scaffold: telegram-bot project (package, tsconfig, vercel.json, env)"
```

---

## Task 2: Config module (env loading + validation)

**Files:**
- Create: `telegram-bot/src/config.ts`
- Test: `telegram-bot/tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const validEnv = {
    TELEGRAM_BOT_TOKEN: "tok",
    TELEGRAM_ALLOWED_CHAT_IDS: "123,456",
    WEBHOOK_SECRET: "secret",
    OPENAI_API_KEY: "sk-xxx",
    BLOB_READ_WRITE_TOKEN: "blob-tok",
  };

  it("parses comma-separated chat IDs into number set", () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.allowedChatIds.has(123)).toBe(true);
    expect(cfg.allowedChatIds.has(456)).toBe(true);
    expect(cfg.allowedChatIds.size).toBe(2);
  });

  it("defaults OPENAI_MODEL to gpt-4o-mini", () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.openaiModel).toBe("gpt-4o-mini");
  });

  it("respects OPENAI_MODEL override", () => {
    const cfg = loadConfig({ ...validEnv, OPENAI_MODEL: "gpt-4o" });
    expect(cfg.openaiModel).toBe("gpt-4o");
  });

  it("throws if TELEGRAM_BOT_TOKEN missing", () => {
    const { TELEGRAM_BOT_TOKEN, ...env } = validEnv;
    expect(() => loadConfig(env)).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("throws on non-numeric chat ID", () => {
    expect(() => loadConfig({ ...validEnv, TELEGRAM_ALLOWED_CHAT_IDS: "abc,123" }))
      .toThrow(/TELEGRAM_ALLOWED_CHAT_IDS/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd telegram-bot && npx vitest run tests/config.test.ts`
Expected: FAIL with module-not-found / import error.

- [ ] **Step 3: Implement `telegram-bot/src/config.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  GITHUB_PAT: z.string().optional(),
  GITHUB_REPO: z.string().default("amitkumardas/freeformfitnessOS"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = {
  telegramBotToken: string;
  allowedChatIds: Set<number>;
  webhookSecret: string;
  openaiApiKey: string;
  openaiModel: string;
  blobReadWriteToken: string;
  githubPat: string | undefined;
  githubRepo: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  const idStrings = parsed.data.TELEGRAM_ALLOWED_CHAT_IDS.split(",").map(s => s.trim());
  const ids = new Set<number>();
  for (const s of idStrings) {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`Invalid environment: TELEGRAM_ALLOWED_CHAT_IDS contains non-integer "${s}"`);
    }
    ids.add(n);
  }
  return {
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    allowedChatIds: ids,
    webhookSecret: parsed.data.WEBHOOK_SECRET,
    openaiApiKey: parsed.data.OPENAI_API_KEY,
    openaiModel: parsed.data.OPENAI_MODEL,
    blobReadWriteToken: parsed.data.BLOB_READ_WRITE_TOKEN,
    githubPat: parsed.data.GITHUB_PAT,
    githubRepo: parsed.data.GITHUB_REPO,
    logLevel: parsed.data.LOG_LEVEL,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd telegram-bot && npx vitest run tests/config.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/config.ts telegram-bot/tests/config.test.ts
git commit -m "feat(bot): config module with env validation"
```

---

## Task 3: Indian rupee formatter

**Files:**
- Create: `telegram-bot/src/telegram/format.ts`
- Test: `telegram-bot/tests/format.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatINR } from "../src/telegram/format.js";

describe("formatINR", () => {
  it("formats lakh with Indian commas", () => {
    expect(formatINR(305700)).toBe("₹3,05,700");
  });
  it("formats thousand", () => {
    expect(formatINR(2000)).toBe("₹2,000");
  });
  it("formats crore", () => {
    expect(formatINR(12345678)).toBe("₹1,23,45,678");
  });
  it("formats zero", () => {
    expect(formatINR(0)).toBe("₹0");
  });
  it("rounds decimals to integer rupees", () => {
    expect(formatINR(2000.5)).toBe("₹2,001");
  });
  it("handles negative", () => {
    expect(formatINR(-500)).toBe("-₹500");
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/format.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/telegram/format.ts`**

```ts
const FORMATTER = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatINR(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded < 0) return `-₹${FORMATTER.format(Math.abs(rounded))}`;
  return `₹${FORMATTER.format(rounded)}`;
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/format.test.ts`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/telegram/format.ts telegram-bot/tests/format.test.ts
git commit -m "feat(bot): INR formatter with Indian comma grouping"
```

---

## Task 4: CSV parsing with date/number coercion

**Files:**
- Create: `telegram-bot/src/data/csv-parse.ts`
- Test: `telegram-bot/tests/csv-parse.test.ts`
- Test: `telegram-bot/tests/fixtures/payments-mini.csv`

- [ ] **Step 1: Create test fixture `telegram-bot/tests/fixtures/payments-mini.csv`**

```csv
Sr No.,Payment Date,Billing Name,Payment Mode,Paid Amount,Bill No
1,01-04-2026,saba khan,Cash,2000,2026/4/429399
2,02-04-2026,sanal,Cash,"1,200",2026/4/429284
3,04-04-2026,viral,Gpay,15000,2026/4/429540
4,,blank date,Cash,500,
```

- [ ] **Step 2: Write the failing test**

`telegram-bot/tests/csv-parse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/data/csv-parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures/payments-mini.csv"), "utf8");

describe("parseCsv", () => {
  it("returns rows with header keys preserved", () => {
    const { rows, columns } = parseCsv(fixture);
    expect(columns).toContain("Payment Date");
    expect(columns).toContain("Paid Amount");
    expect(rows.length).toBe(4);
  });

  it("coerces DD-MM-YYYY dates to ISO YYYY-MM-DD", () => {
    const { rows } = parseCsv(fixture, { dateColumns: ["Payment Date"] });
    expect(rows[0]!["Payment Date"]).toBe("2026-04-01");
    expect(rows[1]!["Payment Date"]).toBe("2026-04-02");
    expect(rows[3]!["Payment Date"]).toBe(null);
  });

  it("coerces money strings with commas to numbers", () => {
    const { rows } = parseCsv(fixture, { numberColumns: ["Paid Amount"] });
    expect(rows[0]!["Paid Amount"]).toBe(2000);
    expect(rows[1]!["Paid Amount"]).toBe(1200);
    expect(rows[2]!["Paid Amount"]).toBe(15000);
  });

  it("treats blank cells as null after coercion", () => {
    const { rows } = parseCsv(fixture);
    expect(rows[3]!["Bill No"]).toBe(null);
  });
});
```

- [ ] **Step 3: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/csv-parse.test.ts`

- [ ] **Step 4: Implement `telegram-bot/src/data/csv-parse.ts`**

```ts
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
```

- [ ] **Step 5: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/csv-parse.test.ts`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add telegram-bot/src/data/csv-parse.ts telegram-bot/tests/csv-parse.test.ts telegram-bot/tests/fixtures/
git commit -m "feat(bot): CSV parser with DD-MM-YYYY date + comma-number coercion"
```

---

## Task 5: query_csv DSL executor

**Files:**
- Create: `telegram-bot/src/tools/query-csv.ts`
- Test: `telegram-bot/tests/query-csv.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/query-csv.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { CsvRow } from "../src/data/csv-parse.js";
import { applyQuery } from "../src/tools/query-csv.js";

const rows: CsvRow[] = [
  { "Payment Date": "2026-04-01", "Billing Name": "saba khan", "Payment Mode": "Cash",  "Paid Amount": 2000 },
  { "Payment Date": "2026-04-02", "Billing Name": "sanal",     "Payment Mode": "Cash",  "Paid Amount": 600 },
  { "Payment Date": "2026-04-04", "Billing Name": "viral",     "Payment Mode": "Cash",  "Paid Amount": 15000 },
  { "Payment Date": "2026-04-07", "Billing Name": "biraj",     "Payment Mode": "Gpay",  "Paid Amount": 15000 },
  { "Payment Date": "2026-04-07", "Billing Name": "ronak",     "Payment Mode": "Gpay",  "Paid Amount": 11000 },
];

describe("applyQuery filters", () => {
  it("eq + between", () => {
    const r = applyQuery(rows, {
      filters: [
        { col: "Payment Mode", op: "eq", val: "Cash" },
        { col: "Payment Date", op: "between", val: ["2026-04-01", "2026-04-07"] },
      ],
    });
    expect(r.row_count).toBe(3);
  });
  it("icontains", () => {
    const r = applyQuery(rows, { filters: [{ col: "Billing Name", op: "icontains", val: "VIR" }] });
    expect(r.row_count).toBe(1);
    expect(r.rows[0]!["Billing Name"]).toBe("viral");
  });
  it("in", () => {
    const r = applyQuery(rows, { filters: [{ col: "Payment Mode", op: "in", val: ["Gpay"] }] });
    expect(r.row_count).toBe(2);
  });
  it("gt / gte / lt / lte / neq", () => {
    expect(applyQuery(rows, { filters: [{ col: "Paid Amount", op: "gt", val: 10000 }] }).row_count).toBe(3);
    expect(applyQuery(rows, { filters: [{ col: "Paid Amount", op: "gte", val: 11000 }] }).row_count).toBe(3);
    expect(applyQuery(rows, { filters: [{ col: "Paid Amount", op: "lt", val: 2000 }] }).row_count).toBe(1);
    expect(applyQuery(rows, { filters: [{ col: "Paid Amount", op: "lte", val: 2000 }] }).row_count).toBe(2);
    expect(applyQuery(rows, { filters: [{ col: "Payment Mode", op: "neq", val: "Cash" }] }).row_count).toBe(2);
  });
});

describe("applyQuery agg + group_by", () => {
  it("sum without group_by returns scalar", () => {
    const r = applyQuery(rows, { agg: { col: "Paid Amount", fn: "sum" } });
    expect(r.agg_result).toBe(43600);
  });
  it("group_by + sum returns object", () => {
    const r = applyQuery(rows, {
      group_by: ["Payment Mode"],
      agg: { col: "Paid Amount", fn: "sum" },
    });
    expect(r.agg_result).toEqual({ Cash: 17600, Gpay: 26000 });
  });
  it("count fn", () => {
    const r = applyQuery(rows, { agg: { col: "Paid Amount", fn: "count" } });
    expect(r.agg_result).toBe(5);
  });
});

describe("applyQuery projection + order + limit", () => {
  it("select projects columns", () => {
    const r = applyQuery(rows, { select: ["Billing Name"] });
    expect(Object.keys(r.rows[0]!)).toEqual(["Billing Name"]);
  });
  it("order_by asc/desc", () => {
    const r = applyQuery(rows, { order_by: { col: "Paid Amount", dir: "desc" }, limit: 2 });
    expect(r.rows.map(x => x["Paid Amount"])).toEqual([15000, 15000]);
  });
  it("limit truncates", () => {
    const r = applyQuery(rows, { limit: 2 });
    expect(r.row_count).toBe(2);
    expect(r.truncated).toBe(true);
  });
});

describe("applyQuery errors", () => {
  it("invalid op returns structured error", () => {
    const r = applyQuery(rows, { filters: [{ col: "Paid Amount", op: "bogus" as any, val: 1 }] });
    expect(r.error).toMatch(/op/);
  });
  it("unknown column returns structured error", () => {
    const r = applyQuery(rows, { filters: [{ col: "NoSuchCol", op: "eq", val: 1 }] });
    expect(r.error).toMatch(/column/i);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/query-csv.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/tools/query-csv.ts`**

```ts
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
    case "in": return f.val.some(x => cmp(v, x) === 0);
    case "icontains":
      return v != null && String(v).toLowerCase().includes(String(f.val).toLowerCase());
    case "isblank":  return v == null || v === "";
    case "notblank": return !(v == null || v === "");
  }
}

export function applyQuery(rows: CsvRow[], args: QueryArgs): QueryResult {
  const columns = new Set(rows.length > 0 ? Object.keys(rows[0]!) : []);

  for (const f of args.filters ?? []) {
    if (!VALID_OPS.has(f.op)) return err(`Unknown op: ${f.op}`, `Valid ops: ${[...VALID_OPS].join(", ")}`);
    if (rows.length > 0 && !columns.has(f.col)) return err(`Unknown column: ${f.col}`, `Available: ${[...columns].join(", ")}`);
  }
  if (args.agg && !VALID_FNS.has(args.agg.fn)) {
    return err(`Unknown agg fn: ${args.agg.fn}`, `Valid: ${[...VALID_FNS].join(", ")}`);
  }
  if (args.agg && rows.length > 0 && !columns.has(args.agg.col)) {
    return err(`Unknown agg column: ${args.agg.col}`);
  }
  for (const c of args.group_by ?? []) {
    if (rows.length > 0 && !columns.has(c)) return err(`Unknown group_by column: ${c}`);
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
    return { rows: [], row_count: filtered.length, truncated: false, agg_result: aggregateOver(filtered, col, fn) };
  }

  if (args.order_by) {
    const { col, dir } = args.order_by;
    if (rows.length > 0 && !columns.has(col)) return err(`Unknown order_by column: ${col}`);
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
  const nums = rows.map(r => asNum(r[col] ?? null)).filter((n): n is number => n != null);
  if (nums.length === 0) return 0;
  switch (fn) {
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "avg": return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "min": return Math.min(...nums);
    case "max": return Math.max(...nums);
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/query-csv.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/tools/query-csv.ts telegram-bot/tests/query-csv.test.ts
git commit -m "feat(bot): query_csv DSL executor (filters/agg/group_by/order/limit)"
```

---

## Task 6: Tool JSON schemas (for OpenAI)

**Files:**
- Create: `telegram-bot/src/tools/schema.ts`
- Test: `telegram-bot/tests/schema.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { QUERY_CSV_TOOL, LIST_CSVS_TOOL, parseQueryArgs } from "../src/tools/schema.js";

describe("tool definitions", () => {
  it("LIST_CSVS_TOOL is OpenAI tool shape", () => {
    expect(LIST_CSVS_TOOL.type).toBe("function");
    expect(LIST_CSVS_TOOL.function.name).toBe("list_csvs");
  });
  it("QUERY_CSV_TOOL has required csv arg", () => {
    expect(QUERY_CSV_TOOL.function.parameters.required).toContain("csv");
  });
});

describe("parseQueryArgs", () => {
  it("accepts minimal valid args", () => {
    const r = parseQueryArgs({ csv: "payments" });
    expect(r.csv).toBe("payments");
  });
  it("rejects missing csv", () => {
    expect(() => parseQueryArgs({})).toThrow();
  });
  it("accepts filters + agg", () => {
    const r = parseQueryArgs({
      csv: "payments",
      filters: [{ col: "X", op: "eq", val: 1 }],
      agg: { col: "Paid Amount", fn: "sum" },
    });
    expect(r.agg?.fn).toBe("sum");
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/schema.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/tools/schema.ts`**

```ts
import { z } from "zod";
import type { QueryArgs } from "./query-csv.js";

const cellSchema = z.union([z.string(), z.number(), z.null()]);

const filterSchema = z.discriminatedUnion("op", [
  z.object({ col: z.string(), op: z.enum(["eq","neq","gt","gte","lt","lte","icontains"]), val: cellSchema }),
  z.object({ col: z.string(), op: z.literal("between"), val: z.tuple([cellSchema, cellSchema]) }),
  z.object({ col: z.string(), op: z.literal("in"), val: z.array(cellSchema) }),
  z.object({ col: z.string(), op: z.enum(["isblank","notblank"]) }),
]);

export const queryArgsSchema = z.object({
  csv: z.string(),
  filters: z.array(filterSchema).optional(),
  group_by: z.array(z.string()).optional(),
  agg: z.object({ col: z.string(), fn: z.enum(["sum","count","avg","min","max"]) }).optional(),
  select: z.array(z.string()).optional(),
  order_by: z.object({ col: z.string(), dir: z.enum(["asc","desc"]) }).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export type ParsedQueryArgs = z.infer<typeof queryArgsSchema> & { csv: string } & QueryArgs;

export function parseQueryArgs(raw: unknown): ParsedQueryArgs {
  return queryArgsSchema.parse(raw) as ParsedQueryArgs;
}

export const LIST_CSVS_TOOL = {
  type: "function" as const,
  function: {
    name: "list_csvs",
    description: "List all available CSVs with their columns and sample rows. Call once before query_csv.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

export const QUERY_CSV_TOOL = {
  type: "function" as const,
  function: {
    name: "query_csv",
    description:
      "Query one CSV with filters/agg/group_by/order_by/limit. " +
      "Use list_csvs first to discover available CSV names and columns.",
    parameters: {
      type: "object",
      required: ["csv"],
      additionalProperties: false,
      properties: {
        csv: { type: "string", description: "CSV name from list_csvs (e.g. 'payments')" },
        filters: {
          type: "array",
          items: {
            type: "object",
            required: ["col", "op"],
            properties: {
              col: { type: "string" },
              op: { type: "string", enum: ["eq","neq","gt","gte","lt","lte","between","in","icontains","isblank","notblank"] },
              val: {},
            },
          },
        },
        group_by: { type: "array", items: { type: "string" } },
        agg: {
          type: "object",
          required: ["col", "fn"],
          properties: {
            col: { type: "string" },
            fn: { type: "string", enum: ["sum","count","avg","min","max"] },
          },
        },
        select: { type: "array", items: { type: "string" } },
        order_by: {
          type: "object",
          required: ["col", "dir"],
          properties: { col: { type: "string" }, dir: { type: "string", enum: ["asc","desc"] } },
        },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
  },
};
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/schema.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/tools/schema.ts telegram-bot/tests/schema.test.ts
git commit -m "feat(bot): zod schemas + OpenAI tool definitions"
```

---

## Task 7: Blob store client

**Files:**
- Create: `telegram-bot/src/data/blob-store.ts`
- Test: `telegram-bot/tests/blob-store.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/blob-store.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBlobStore, type LatestPointer } from "../src/data/blob-store.js";

const pointer: LatestPointer = {
  snapshot_date: "2026-05-16",
  snapshot_ist: "2026-05-16T06:02:11+05:30",
  row_counts: { payments: 670, members: 412 },
  blob_urls: {
    payments: "https://blob.example/csv/2026-05-16/payments-h1.csv",
    members:  "https://blob.example/csv/2026-05-16/members-h2.csv",
  },
};

describe("blob store", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetchLatest returns pointer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({ latestUrl: "https://blob.example/csv/latest.json", fetch: fetchMock });
    const p = await store.fetchLatest();
    expect(p.snapshot_date).toBe("2026-05-16");
    expect(fetchMock).toHaveBeenCalledWith("https://blob.example/csv/latest.json", expect.anything());
  });

  it("fetchCsv reads URL from pointer", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(pointer)))
      .mockResolvedValueOnce(new Response("Sr No.,Paid Amount\n1,2000\n"));
    const store = createBlobStore({ latestUrl: "https://blob.example/csv/latest.json", fetch: fetchMock });
    const csv = await store.fetchCsv("payments");
    expect(csv).toContain("Paid Amount");
    expect(fetchMock).toHaveBeenLastCalledWith(pointer.blob_urls.payments, expect.anything());
  });

  it("throws on missing CSV name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({ latestUrl: "https://blob.example/csv/latest.json", fetch: fetchMock });
    await expect(store.fetchCsv("doesnotexist")).rejects.toThrow(/doesnotexist/);
  });

  it("caches pointer for 60s", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({ latestUrl: "https://blob.example/csv/latest.json", fetch: fetchMock });
    await store.fetchLatest();
    await store.fetchLatest();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/blob-store.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/data/blob-store.ts`**

```ts
export interface LatestPointer {
  snapshot_date: string;
  snapshot_ist: string;
  row_counts: Record<string, number>;
  blob_urls: Record<string, string>;
}

export interface BlobStore {
  fetchLatest(): Promise<LatestPointer>;
  fetchCsv(name: string): Promise<string>;
}

export interface BlobStoreOptions {
  latestUrl: string;
  fetch?: typeof fetch;
  cacheTtlMs?: number;
}

export function createBlobStore(opts: BlobStoreOptions): BlobStore {
  const fetcher = opts.fetch ?? globalThis.fetch;
  const ttl = opts.cacheTtlMs ?? 60_000;
  let cached: { pointer: LatestPointer; at: number } | null = null;
  const csvCache = new Map<string, string>();

  async function fetchLatest(): Promise<LatestPointer> {
    if (cached && Date.now() - cached.at < ttl) return cached.pointer;
    const res = await fetcher(opts.latestUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`latest.json fetch failed: ${res.status}`);
    const pointer = (await res.json()) as LatestPointer;
    cached = { pointer, at: Date.now() };
    csvCache.clear();
    return pointer;
  }

  async function fetchCsv(name: string): Promise<string> {
    const pointer = await fetchLatest();
    const url = pointer.blob_urls[name];
    if (!url) throw new Error(`Unknown CSV: ${name}. Available: ${Object.keys(pointer.blob_urls).join(", ")}`);
    const hit = csvCache.get(name);
    if (hit) return hit;
    const res = await fetcher(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV ${name} fetch failed: ${res.status}`);
    const text = await res.text();
    csvCache.set(name, text);
    return text;
  }

  return { fetchLatest, fetchCsv };
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/blob-store.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/data/blob-store.ts telegram-bot/tests/blob-store.test.ts
git commit -m "feat(bot): blob store client with 60s pointer cache"
```

---

## Task 8: list_csvs implementation (metadata builder)

**Files:**
- Create: `telegram-bot/src/tools/list-csvs.ts`
- Test: `telegram-bot/tests/list-csvs.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/list-csvs.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { buildListCsvsResult, CSV_HINTS } from "../src/tools/list-csvs.js";
import type { BlobStore } from "../src/data/blob-store.js";

const pointer = {
  snapshot_date: "2026-05-16",
  snapshot_ist: "2026-05-16T06:02:11+05:30",
  row_counts: { payments: 4 },
  blob_urls: { payments: "https://blob.example/p.csv" },
};

const sampleCsv =
  "Payment Date,Billing Name,Paid Amount\n" +
  "01-04-2026,saba,2000\n02-04-2026,sanal,600\n04-04-2026,viral,15000\n";

describe("buildListCsvsResult", () => {
  it("returns csv metadata using hints for date/number columns", async () => {
    const store: BlobStore = {
      fetchLatest: vi.fn().mockResolvedValue(pointer),
      fetchCsv: vi.fn().mockResolvedValue(sampleCsv),
    };
    const out = await buildListCsvsResult(store);
    expect(out.snapshot_date).toBe("2026-05-16");
    const payments = out.csvs.find(c => c.name === "payments")!;
    expect(payments.columns).toContain("Billing Name");
    expect(payments.date_columns).toContain("Payment Date");
    expect(payments.sample_rows.length).toBeGreaterThan(0);
    expect(payments.rows).toBe(3);
  });

  it("CSV_HINTS has entries for all 8 expected CSVs", () => {
    const expected = ["payments","members","balance","memberenrollment","activeinactive","database","member_details","sessionreport"];
    for (const name of expected) expect(CSV_HINTS[name]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/list-csvs.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/tools/list-csvs.ts`**

```ts
import { parseCsv } from "../data/csv-parse.js";
import type { BlobStore } from "../data/blob-store.js";

export interface CsvMeta {
  name: string;
  rows: number;
  columns: string[];
  date_columns: string[];
  number_columns: string[];
  sample_rows: Record<string, string | number | null>[];
}

export interface ListCsvsResult {
  snapshot_date: string;
  snapshot_ist: string;
  csvs: CsvMeta[];
}

export const CSV_HINTS: Record<string, { date: string[]; number: string[] }> = {
  payments:         { date: ["Payment Date","Start Date","End Date","Created On"], number: ["Membership Amount","Total Amount","Discount","Net Amount","Paid Amount","Balance Amount"] },
  members:          { date: ["Joining Date","Date of Birth","Start Date","End Date"], number: ["Membership Amount","Paid Amount","Balance Amount"] },
  balance:          { date: ["Start Date","End Date","Payment Date"], number: ["Total Amount","Paid Amount","Balance Amount"] },
  memberenrollment: { date: ["Joining Date","Start Date","End Date"], number: ["Membership Amount","Paid Amount","Balance Amount"] },
  activeinactive:   { date: ["Joining Date","Start Date","End Date"], number: ["Membership Amount","Balance Amount"] },
  database:         { date: ["Joining Date","Date of Birth"], number: [] },
  member_details:   { date: ["Joining Date","Date of Birth"], number: ["Balance Amount"] },
  sessionreport:    { date: ["Session Date"], number: ["Sessions"] },
};

const SAMPLE_SIZE = 2;

export async function buildListCsvsResult(store: BlobStore): Promise<ListCsvsResult> {
  const pointer = await store.fetchLatest();
  const names = Object.keys(pointer.blob_urls);
  const csvs: CsvMeta[] = [];
  for (const name of names) {
    const hint = CSV_HINTS[name] ?? { date: [], number: [] };
    const text = await store.fetchCsv(name);
    const { columns, rows } = parseCsv(text, { dateColumns: hint.date, numberColumns: hint.number });
    csvs.push({
      name,
      rows: rows.length,
      columns,
      date_columns: hint.date.filter(d => columns.includes(d)),
      number_columns: hint.number.filter(d => columns.includes(d)),
      sample_rows: rows.slice(0, SAMPLE_SIZE),
    });
  }
  return { snapshot_date: pointer.snapshot_date, snapshot_ist: pointer.snapshot_ist, csvs };
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/list-csvs.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/tools/list-csvs.ts telegram-bot/tests/list-csvs.test.ts
git commit -m "feat(bot): list_csvs metadata builder with date/number column hints"
```

---

## Task 9: OpenAI tool-calling loop

**Files:**
- Create: `telegram-bot/src/llm.ts`
- Test: `telegram-bot/tests/llm.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/llm.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { runLlm } from "../src/llm.js";
import type { BlobStore } from "../src/data/blob-store.js";

const pointer = {
  snapshot_date: "2026-05-16",
  snapshot_ist: "2026-05-16T06:02:11+05:30",
  row_counts: { payments: 3 },
  blob_urls: { payments: "https://blob.example/p.csv" },
};
const payCsv =
  "Payment Date,Billing Name,Payment Mode,Paid Amount\n" +
  "01-04-2026,saba,Cash,2000\n02-04-2026,sanal,Cash,600\n04-04-2026,viral,Gpay,15000\n";

function makeStore(): BlobStore {
  return {
    fetchLatest: vi.fn().mockResolvedValue(pointer),
    fetchCsv: vi.fn().mockResolvedValue(payCsv),
  };
}

describe("runLlm", () => {
  it("returns final assistant text after tool calls", async () => {
    let callIdx = 0;
    const openai = {
      chat: { completions: { create: vi.fn().mockImplementation(async () => {
        callIdx++;
        if (callIdx === 1) {
          return { choices: [{ message: { role: "assistant", tool_calls: [
            { id: "t1", type: "function", function: { name: "query_csv", arguments: JSON.stringify({
              csv: "payments", filters: [{ col: "Payment Mode", op: "eq", val: "Cash" }],
              agg: { col: "Paid Amount", fn: "sum" },
            })}}
          ]}}]};
        }
        return { choices: [{ message: { role: "assistant", content: "Cash collections: ₹2,600" } }] };
      })}}
    } as any;

    const result = await runLlm({
      question: "how much cash collected?",
      openai, model: "gpt-4o-mini",
      store: makeStore(),
      maxIterations: 5,
    });
    expect(result.text).toContain("₹2,600");
    expect(result.toolCalls).toBe(1);
  });

  it("stops after maxIterations and returns fallback", async () => {
    const openai = { chat: { completions: { create: vi.fn().mockResolvedValue({
      choices: [{ message: { role: "assistant", tool_calls: [
        { id: "x", type: "function", function: { name: "list_csvs", arguments: "{}" } }
      ]}}]
    })}}} as any;

    const result = await runLlm({
      question: "loop forever",
      openai, model: "gpt-4o-mini",
      store: makeStore(),
      maxIterations: 3,
    });
    expect(result.text).toMatch(/couldn't figure out/i);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/llm.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/llm.ts`**

```ts
import type OpenAI from "openai";
import type { BlobStore } from "./data/blob-store.js";
import { parseCsv } from "./data/csv-parse.js";
import { buildListCsvsResult, CSV_HINTS } from "./tools/list-csvs.js";
import { LIST_CSVS_TOOL, QUERY_CSV_TOOL, parseQueryArgs } from "./tools/schema.js";
import { applyQuery } from "./tools/query-csv.js";

export interface RunLlmInput {
  question: string;
  openai: OpenAI;
  model: string;
  store: BlobStore;
  maxIterations?: number;
}

export interface RunLlmResult {
  text: string;
  toolCalls: number;
  snapshotDate: string;
}

const SYSTEM_PROMPT = (snapshot: string, todayIso: string) => `
You are a data analyst for Free Form Fitness gym. Answer the user's question using ONLY the
data returned by your tools. Never make up numbers.

Tools:
- list_csvs: see what data exists. Call first if you are unsure of CSV names or columns.
- query_csv: query one CSV with filters / group_by / agg.

Rules:
- All money is in Indian rupees, formatted with Indian commas (₹3,05,700).
- Today's date is ${todayIso}. Snapshot date is ${snapshot}.
- If the answer requires data not in the CSVs, say so plainly.
- Keep replies short. End with: "📅 data as of ${snapshot}".
- If the question is ambiguous (e.g. "this week" without specifying), pick the most likely
  interpretation and state it briefly.
`.trim();

export async function runLlm(input: RunLlmInput): Promise<RunLlmResult> {
  const { openai, model, store, question } = input;
  const maxIter = input.maxIterations ?? 5;
  const pointer = await store.fetchLatest();
  const todayIso = new Date().toISOString().slice(0, 10);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT(pointer.snapshot_date, todayIso) },
    { role: "user", content: question },
  ];

  let toolCalls = 0;
  for (let i = 0; i < maxIter; i++) {
    const resp = await openai.chat.completions.create({
      model,
      messages,
      tools: [LIST_CSVS_TOOL, QUERY_CSV_TOOL],
      tool_choice: "auto",
    });
    const msg = resp.choices[0]!.message;
    messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { text: msg.content ?? "", toolCalls, snapshotDate: pointer.snapshot_date };
    }

    for (const call of msg.tool_calls) {
      toolCalls++;
      let content: string;
      try {
        if (call.function.name === "list_csvs") {
          const r = await buildListCsvsResult(store);
          content = JSON.stringify(r);
        } else if (call.function.name === "query_csv") {
          const args = parseQueryArgs(JSON.parse(call.function.arguments));
          const hint = CSV_HINTS[args.csv] ?? { date: [], number: [] };
          const text = await store.fetchCsv(args.csv);
          const { rows } = parseCsv(text, { dateColumns: hint.date, numberColumns: hint.number });
          content = JSON.stringify(applyQuery(rows, args));
        } else {
          content = JSON.stringify({ error: `Unknown tool: ${call.function.name}` });
        }
      } catch (e) {
        content = JSON.stringify({ error: (e as Error).message });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  return {
    text: "I couldn't figure out how to answer that — try rephrasing.",
    toolCalls,
    snapshotDate: pointer.snapshot_date,
  };
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/llm.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/llm.ts telegram-bot/tests/llm.test.ts
git commit -m "feat(bot): OpenAI tool-calling loop with max-iter bound"
```

---

## Task 10: Telegram sendMessage with chunking

**Files:**
- Create: `telegram-bot/src/telegram/send-message.ts`
- Test: `telegram-bot/tests/send-message.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/send-message.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { chunkText, sendTelegramMessage } from "../src/telegram/send-message.js";

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    expect(chunkText("hi", 3500)).toEqual(["hi"]);
  });
  it("splits long text into chunks", () => {
    const s = "x".repeat(7000);
    const chunks = chunkText(s, 3500);
    expect(chunks.length).toBe(2);
    expect(chunks.every(c => c.length <= 3500)).toBe(true);
  });
  it("splits on paragraph boundary when possible", () => {
    const s = "para1\n\n" + "x".repeat(3490) + "\n\npara3";
    const chunks = chunkText(s, 3500);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.startsWith("para1")).toBe(true);
  });
});

describe("sendTelegramMessage", () => {
  it("POSTs to sendMessage URL with token + chat id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await sendTelegramMessage({
      token: "TOKEN", chatId: 42, text: "hello", fetch: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botTOKEN/sendMessage",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ chat_id: 42, text: "hello" });
  });
  it("sends multiple messages when text > limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await sendTelegramMessage({
      token: "TOK", chatId: 1, text: "x".repeat(7000), fetch: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/send-message.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/telegram/send-message.ts`**

```ts
export const TELEGRAM_MAX_MESSAGE = 3500;

export function chunkText(text: string, max = TELEGRAM_MAX_MESSAGE): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < 200) cut = rest.lastIndexOf("\n", max);
    if (cut < 200) cut = rest.lastIndexOf(" ", max);
    if (cut < 200) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

export interface SendMessageInput {
  token: string;
  chatId: number;
  text: string;
  fetch?: typeof fetch;
}

export async function sendTelegramMessage(input: SendMessageInput): Promise<void> {
  const fetcher = input.fetch ?? globalThis.fetch;
  const url = `https://api.telegram.org/bot${input.token}/sendMessage`;
  const chunks = chunkText(input.text);
  for (const chunk of chunks) {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: input.chatId, text: chunk }),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/send-message.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/telegram/send-message.ts telegram-bot/tests/send-message.test.ts
git commit -m "feat(bot): telegram sendMessage client with 3500-char chunking"
```

---

## Task 11: Auth + rate limit

**Files:**
- Create: `telegram-bot/src/auth.ts`
- Create: `telegram-bot/src/rate-limit.ts`
- Test: `telegram-bot/tests/auth.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/auth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isAllowed, checkSecretToken } from "../src/auth.js";
import { createRateLimiter } from "../src/rate-limit.js";

describe("isAllowed", () => {
  const allowed = new Set([1, 2]);
  it("permits ids in the set", () => { expect(isAllowed(1, allowed)).toBe(true); });
  it("rejects ids not in set", () => { expect(isAllowed(99, allowed)).toBe(false); });
});

describe("checkSecretToken", () => {
  it("passes when header matches", () => { expect(checkSecretToken("abc", "abc")).toBe(true); });
  it("fails when mismatch", () => { expect(checkSecretToken("abc", "xyz")).toBe(false); });
  it("fails when undefined", () => { expect(checkSecretToken(undefined, "abc")).toBe(false); });
});

describe("createRateLimiter", () => {
  it("allows first N calls", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(false);
  });
  it("isolates per chat id", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(false);
    expect(limiter.check(2)).toBe(true);
  });
  it("resets after window passes", async () => {
    const limiter = createRateLimiter({ windowMs: 50, max: 1 });
    expect(limiter.check(1)).toBe(true);
    expect(limiter.check(1)).toBe(false);
    await new Promise(r => setTimeout(r, 80));
    expect(limiter.check(1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/auth.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/auth.ts`**

```ts
export function isAllowed(chatId: number, allow: ReadonlySet<number>): boolean {
  return allow.has(chatId);
}

export function checkSecretToken(provided: string | undefined, expected: string): boolean {
  return provided !== undefined && provided === expected;
}
```

- [ ] **Step 4: Implement `telegram-bot/src/rate-limit.ts`**

```ts
export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

export interface RateLimiter {
  check(chatId: number): boolean;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const hits = new Map<number, number[]>();
  return {
    check(chatId: number): boolean {
      const now = Date.now();
      const cutoff = now - opts.windowMs;
      const arr = (hits.get(chatId) ?? []).filter(t => t > cutoff);
      if (arr.length >= opts.max) {
        hits.set(chatId, arr);
        return false;
      }
      arr.push(now);
      hits.set(chatId, arr);
      return true;
    },
  };
}
```

- [ ] **Step 5: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/auth.test.ts`

- [ ] **Step 6: Commit**

```bash
git add telegram-bot/src/auth.ts telegram-bot/src/rate-limit.ts telegram-bot/tests/auth.test.ts
git commit -m "feat(bot): allowlist auth, secret-token check, in-mem rate limiter"
```

---

## Task 12: Slash command handler

**Files:**
- Create: `telegram-bot/src/commands.ts`
- Test: `telegram-bot/tests/commands.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/commands.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { handleSlashCommand } from "../src/commands.js";
import type { BlobStore } from "../src/data/blob-store.js";

const pointer = {
  snapshot_date: "2026-05-16",
  snapshot_ist: "2026-05-16T06:02:11+05:30",
  row_counts: { payments: 670, members: 412 },
  blob_urls: { payments: "u1", members: "u2" },
};
const store: BlobStore = {
  fetchLatest: vi.fn().mockResolvedValue(pointer),
  fetchCsv: vi.fn(),
};

describe("handleSlashCommand", () => {
  it("/start returns welcome with chat id", async () => {
    const r = await handleSlashCommand({ text: "/start", chatId: 42, firstName: "Robin", store, dispatchRefresh: vi.fn() });
    expect(r).toMatch(/Robin/);
    expect(r).toMatch(/42/);
  });
  it("/ping returns pong", async () => {
    const r = await handleSlashCommand({ text: "/ping", chatId: 1, firstName: "x", store, dispatchRefresh: vi.fn() });
    expect(r).toBe("pong");
  });
  it("/snapshot returns date + row counts", async () => {
    const r = await handleSlashCommand({ text: "/snapshot", chatId: 1, firstName: "x", store, dispatchRefresh: vi.fn() });
    expect(r).toMatch(/2026-05-16/);
    expect(r).toMatch(/670/);
  });
  it("/help returns example questions", async () => {
    const r = await handleSlashCommand({ text: "/help", chatId: 1, firstName: "x", store, dispatchRefresh: vi.fn() });
    expect(r.toLowerCase()).toMatch(/example|how much|members/);
  });
  it("/refresh invokes dispatchRefresh", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const r = await handleSlashCommand({ text: "/refresh", chatId: 1, firstName: "x", store, dispatchRefresh: dispatch });
    expect(dispatch).toHaveBeenCalled();
    expect(r).toMatch(/refresh started/i);
  });
  it("/refresh without PAT replies disabled", async () => {
    const r = await handleSlashCommand({ text: "/refresh", chatId: 1, firstName: "x", store, dispatchRefresh: undefined });
    expect(r).toMatch(/not configured/i);
  });
  it("returns null for non-slash text", async () => {
    const r = await handleSlashCommand({ text: "how much last week", chatId: 1, firstName: "x", store, dispatchRefresh: vi.fn() });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/commands.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/commands.ts`**

```ts
import type { BlobStore } from "./data/blob-store.js";

export interface SlashContext {
  text: string;
  chatId: number;
  firstName: string;
  store: BlobStore;
  dispatchRefresh?: () => Promise<void>;
}

const HELP = [
  "Try asking:",
  "  • How much did we collect 1-7 April?",
  "  • PT revenue vs gym revenue last week",
  "  • Who paid in cash on 4 April?",
  "  • Total members joined this month",
  "  • Is <member name> active?",
  "",
  "Commands: /start /help /snapshot /refresh /ping",
].join("\n");

export async function handleSlashCommand(ctx: SlashContext): Promise<string | null> {
  const cmd = ctx.text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  switch (cmd) {
    case "/start":
      return `Hi ${ctx.firstName}, you're authorized (chat id ${ctx.chatId}).\nAsk me anything about the gym.\n\n${HELP}`;
    case "/help":
      return HELP;
    case "/ping":
      return "pong";
    case "/snapshot": {
      const p = await ctx.store.fetchLatest();
      const lines = [
        `Last refresh: ${p.snapshot_ist}`,
        `Snapshot date: ${p.snapshot_date}`,
        "",
        "Row counts:",
        ...Object.entries(p.row_counts).map(([k, v]) => `  • ${k}: ${v}`),
      ];
      return lines.join("\n");
    }
    case "/refresh":
      if (!ctx.dispatchRefresh) return "Refresh is not configured (GITHUB_PAT missing).";
      try {
        await ctx.dispatchRefresh();
        return "Refresh started, takes ~5 min. Ask /snapshot in a bit to verify.";
      } catch (e) {
        return `Couldn't trigger refresh: ${(e as Error).message}`;
      }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/commands.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/commands.ts telegram-bot/tests/commands.test.ts
git commit -m "feat(bot): slash command handlers (/start /help /ping /snapshot /refresh)"
```

---

## Task 13: GitHub workflow_dispatch helper

**Files:**
- Create: `telegram-bot/src/github-dispatch.ts`
- Test: `telegram-bot/tests/github-dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

`telegram-bot/tests/github-dispatch.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createGithubDispatcher } from "../src/github-dispatch.js";

describe("createGithubDispatcher", () => {
  it("returns undefined when PAT missing", () => {
    const d = createGithubDispatcher({ pat: undefined, repo: "a/b", workflow: "x.yml" });
    expect(d).toBeUndefined();
  });
  it("POSTs to workflow dispatches endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 204 }));
    const d = createGithubDispatcher({ pat: "PAT", repo: "a/b", workflow: "x.yml", fetch: fetchMock })!;
    await d();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/a/b/actions/workflows/x.yml/dispatches",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer PAT");
  });
  it("throws on non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    const d = createGithubDispatcher({ pat: "PAT", repo: "a/b", workflow: "x.yml", fetch: fetchMock })!;
    await expect(d()).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd telegram-bot && npx vitest run tests/github-dispatch.test.ts`

- [ ] **Step 3: Implement `telegram-bot/src/github-dispatch.ts`**

```ts
export interface DispatchOptions {
  pat: string | undefined;
  repo: string;
  workflow: string;
  ref?: string;
  fetch?: typeof fetch;
}

export function createGithubDispatcher(opts: DispatchOptions): (() => Promise<void>) | undefined {
  if (!opts.pat) return undefined;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const url = `https://api.github.com/repos/${opts.repo}/actions/workflows/${opts.workflow}/dispatches`;
  const ref = opts.ref ?? "main";
  return async () => {
    const res = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref }),
    });
    if (!res.ok) throw new Error(`GitHub dispatch failed: ${res.status} ${await res.text()}`);
  };
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd telegram-bot && npx vitest run tests/github-dispatch.test.ts`

- [ ] **Step 5: Commit**

```bash
git add telegram-bot/src/github-dispatch.ts telegram-bot/tests/github-dispatch.test.ts
git commit -m "feat(bot): GitHub workflow_dispatch helper for /refresh"
```

---

## Task 14: Webhook entry point

**Files:**
- Create: `telegram-bot/api/webhook.ts`

This task wires everything together. It is not unit tested directly (each piece has its own tests); a smoke test happens in Task 19.

- [ ] **Step 1: Implement `telegram-bot/api/webhook.ts`**

```ts
import OpenAI from "openai";
import { loadConfig } from "../src/config.js";
import { isAllowed, checkSecretToken } from "../src/auth.js";
import { createRateLimiter } from "../src/rate-limit.js";
import { sendTelegramMessage } from "../src/telegram/send-message.js";
import { handleSlashCommand } from "../src/commands.js";
import { createBlobStore } from "../src/data/blob-store.js";
import { createGithubDispatcher } from "../src/github-dispatch.js";
import { runLlm } from "../src/llm.js";

const config = loadConfig();
const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

const LATEST_URL = `https://${process.env.VERCEL_BLOB_HOST ?? "blob.vercel-storage.com"}/csv/latest.json`;
const blobStore = createBlobStore({ latestUrl: LATEST_URL });
const dispatcher = createGithubDispatcher({
  pat: config.githubPat,
  repo: config.githubRepo,
  workflow: "refresh-export.yml",
});
const openai = new OpenAI({ apiKey: config.openaiApiKey });

interface TelegramUpdate {
  message?: {
    chat: { id: number; type: string };
    from?: { first_name?: string; username?: string };
    text?: string;
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  if (req.method !== "POST") { res.status(405).end(); return; }

  const tokenHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (!checkSecretToken(typeof tokenHeader === "string" ? tokenHeader : undefined, config.webhookSecret)) {
    res.status(401).end();
    return;
  }

  const update = req.body as TelegramUpdate;
  const msg = update?.message;
  if (!msg || !msg.text) { res.status(200).end(); return; }

  const chatId = msg.chat.id;
  const firstName = msg.from?.first_name ?? "there";
  const text = msg.text;

  if (!isAllowed(chatId, config.allowedChatIds)) {
    await sendTelegramMessage({ token: config.telegramBotToken, chatId, text: "Not authorized." });
    res.status(200).end();
    return;
  }

  if (!rateLimiter.check(chatId)) {
    await sendTelegramMessage({ token: config.telegramBotToken, chatId, text: "Slow down a sec — try again in a moment." });
    res.status(200).end();
    return;
  }

  try {
    const slash = await handleSlashCommand({
      text, chatId, firstName, store: blobStore, dispatchRefresh: dispatcher,
    });

    let reply: string;
    let toolCalls = 0;
    let snapshotDate = "?";
    if (slash !== null) {
      reply = slash;
    } else {
      const llm = await runLlm({
        question: text, openai, model: config.openaiModel, store: blobStore,
      });
      reply = llm.text;
      toolCalls = llm.toolCalls;
      snapshotDate = llm.snapshotDate;
    }

    await sendTelegramMessage({ token: config.telegramBotToken, chatId, text: reply });
    console.log(JSON.stringify({
      ts: new Date().toISOString(), chat_id: chatId, q: text.slice(0, 200),
      n_tool_calls: toolCalls, model: config.openaiModel, latency_ms: Date.now() - started,
      snapshot_date: snapshotDate, answer_preview: reply.slice(0, 200),
    }));
    res.status(200).end();
  } catch (e) {
    console.error("webhook error", e);
    try {
      await sendTelegramMessage({
        token: config.telegramBotToken, chatId,
        text: "Something broke on my side — try again in a minute.",
      });
    } catch { /* swallow */ }
    res.status(200).end();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd telegram-bot && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `cd telegram-bot && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add telegram-bot/api/webhook.ts
git commit -m "feat(bot): /api/webhook entry point wiring auth, slash, LLM, telegram"
```

---

## Task 15: register-webhook helper script

**Files:**
- Create: `telegram-bot/scripts/register-webhook.mjs`

- [ ] **Step 1: Implement `telegram-bot/scripts/register-webhook.mjs`**

```js
#!/usr/bin/env node
// Usage:
//   TELEGRAM_BOT_TOKEN=... WEBHOOK_SECRET=... WEBHOOK_URL=https://.../api/webhook \
//     node scripts/register-webhook.mjs
//
// Re-run any time you change the URL or secret.

const token  = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const url    = process.env.WEBHOOK_URL;

for (const [k, v] of Object.entries({ TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret, WEBHOOK_URL: url })) {
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
}

const endpoint = `https://api.telegram.org/bot${token}/setWebhook`;
const body = { url, secret_token: secret, allowed_updates: ["message"] };

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const out = await res.json();
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
```

- [ ] **Step 2: Commit**

```bash
git add telegram-bot/scripts/register-webhook.mjs
git commit -m "feat(bot): register-webhook helper script"
```

---

## Task 16: upload-blob script (used by GH Action)

**Files:**
- Create: `telegram-bot/scripts/upload-blob.mjs`
- Create: `telegram-bot/scripts/requirements-cron.txt`

- [ ] **Step 1: Implement `telegram-bot/scripts/upload-blob.mjs`**

```js
#!/usr/bin/env node
// Usage: node scripts/upload-blob.mjs <csv-dir>
//
// Reads all *.csv files in <csv-dir>, uploads each to Vercel Blob under
// csv/YYYY-MM-DD/<name>.csv, then writes csv/latest.json (atomic swap).
//
// Required env: BLOB_READ_WRITE_TOKEN

import { put, list, del } from "@vercel/blob";
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";

// FB export filename → canonical CSV name used in latest.json
const NAME_MAP = {
  "export_payment_all":          "payments",
  "export_database_all":         "database",
  "export_balance_all":          "balance",
  "export_memberenrollment_all": "memberenrollment",
  "export_activeinactive_all":   "activeinactive",
  "member_details_all":          "member_details",
  "ajax_memberships_Data1":      "members",
  "page_sessionreport":          "sessionreport",
};
const RETENTION_DAYS = 30;
const DATE_RE = /^csv\/(\d{4}-\d{2}-\d{2})\//;

const dir = process.argv[2];
if (!dir) { console.error("Usage: upload-blob.mjs <csv-dir>"); process.exit(1); }
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) { console.error("BLOB_READ_WRITE_TOKEN missing"); process.exit(1); }

const today = new Date();
const datePart = today.toISOString().slice(0, 10);
const istIso = new Date(today.getTime() + 5.5 * 3600 * 1000).toISOString().replace("Z", "+05:30");

const files = (await readdir(dir)).filter(f => f.toLowerCase().endsWith(".csv"));
const urls = {};
const rowCounts = {};

for (const file of files) {
  const stem = basename(file, extname(file));
  const canonical = NAME_MAP[stem];
  if (!canonical) { console.log(`Skipping ${file} (no mapping)`); continue; }
  const full = resolve(dir, file);
  const text = await readFile(full, "utf8");
  rowCounts[canonical] = Math.max(0, text.split(/\r?\n/).filter(l => l.length > 0).length - 1);

  const result = await put(`csv/${datePart}/${canonical}.csv`, text, {
    access: "public",
    contentType: "text/csv",
    token,
    addRandomSuffix: true,
    allowOverwrite: false,
  });
  urls[canonical] = result.url;
  console.log(`Uploaded ${canonical}: ${result.url}`);
}

const latest = {
  snapshot_date: datePart,
  snapshot_ist: istIso,
  row_counts: rowCounts,
  blob_urls: urls,
};
const latestRes = await put("csv/latest.json", JSON.stringify(latest, null, 2), {
  access: "public",
  contentType: "application/json",
  token,
  addRandomSuffix: false,
  allowOverwrite: true,
});
console.log(`Wrote latest.json: ${latestRes.url}`);

// Retention: delete snapshots older than RETENTION_DAYS
const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
let cursor;
do {
  const page = await list({ token, prefix: "csv/", cursor, limit: 1000 });
  cursor = page.cursor;
  for (const blob of page.blobs) {
    const m = blob.pathname.match(DATE_RE);
    if (!m) continue;
    const blobDate = Date.parse(`${m[1]}T00:00:00Z`);
    if (blobDate < cutoff) {
      await del(blob.url, { token });
      console.log(`Deleted old snapshot: ${blob.pathname}`);
    }
  }
} while (cursor);
```

- [ ] **Step 2: Implement `telegram-bot/scripts/requirements-cron.txt`**

```
# Python deps for fetch_complete.py (GitHub Actions side)
requests>=2.31
beautifulsoup4>=4.12
```

(Adjust this list later if `fetch_complete.py` imports more.)

- [ ] **Step 3: Commit**

```bash
git add telegram-bot/scripts/upload-blob.mjs telegram-bot/scripts/requirements-cron.txt
git commit -m "feat(bot): upload-blob.mjs + python deps file for GH Action"
```

---

## Task 17: GitHub Actions refresh workflow

**Files:**
- Create: `.github/workflows/refresh-export.yml` (at REPO ROOT, NOT inside telegram-bot/)

- [ ] **Step 1: Verify the existing fetch_complete.py supports `--out`**

The fetcher must accept an output directory flag. From the main repo (or any worktree that has the data dir):

Run: `python3 freeformfitness-data-export-fresh/fetch_complete.py --help`

If `--out` is NOT supported, add a sub-step in this task to patch `fetch_complete.py`:
- Add `argparse` with `--out` (default to script directory).
- Change every CSV write location to write into `args.out`.

If `--out` IS supported, skip the patch step.

- [ ] **Step 2: Ensure the fetcher scripts are tracked in git so GH Actions can run them**

```bash
git add freeformfitness-data-export-fresh/fetch_complete.py \
        freeformfitness-data-export-fresh/fetch_ajax_data.py \
        freeformfitness-data-export-fresh/fetch_exports.py
printf '*.csv\n*.txt\n' > freeformfitness-data-export-fresh/.gitignore
git add freeformfitness-data-export-fresh/.gitignore
git commit -m "chore: track FB export fetcher scripts (data dir gitignored)"
```

- [ ] **Step 3: Create `.github/workflows/refresh-export.yml`** (at repo root)

```yaml
name: refresh-fitnessboard-export
on:
  schedule:
    - cron: "30 0 * * *"     # 00:30 UTC = 06:00 IST
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Install Python deps
        run: pip install -r telegram-bot/scripts/requirements-cron.txt
      - name: Install Node deps (Blob SDK only)
        run: cd telegram-bot && npm install --omit=dev @vercel/blob
      - name: Fetch fresh CSVs
        env:
          FB_MOBILE:   ${{ secrets.FB_MOBILE }}
          FB_PASSWORD: ${{ secrets.FB_PASSWORD_FFF }}
        run: |
          mkdir -p /tmp/csvs
          python freeformfitness-data-export-fresh/fetch_complete.py --out /tmp/csvs
      - name: Upload CSVs to Vercel Blob
        env:
          BLOB_READ_WRITE_TOKEN: ${{ secrets.VERCEL_BLOB_RW_TOKEN }}
        run: node telegram-bot/scripts/upload-blob.mjs /tmp/csvs
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/refresh-export.yml
git commit -m "ci: daily GH Actions cron to refresh CSVs to Vercel Blob"
```

---

## Task 18: README with deploy steps + smoke test plan

**Files:**
- Modify: `telegram-bot/README.md`

- [ ] **Step 1: Replace `telegram-bot/README.md` contents**

```markdown
# FreeForm Telegram Bot

Talk-to-data Telegram bot for FreeForm Fitness gym. Allowlisted (Amit + Robin).
Answers natural-language questions about collections, members, balances, etc.
grounded in daily FitnessBoard CSV exports.

See `docs/specs/2026-05-16-telegram-data-bot-design.md` for design and
`docs/plans/2026-05-16-telegram-data-bot.md` for the implementation plan.

## Local development

    npm install
    npm test
    npm run typecheck

## One-time setup

1. **Create the bot:** Telegram → @BotFather → `/newbot` → copy `TELEGRAM_BOT_TOKEN`.
2. **Each user `/start`s the bot once.** Capture their `chat.id` from Vercel logs (or use the `getUpdates` API). Set `TELEGRAM_ALLOWED_CHAT_IDS=<amit_id>,<robin_id>`.
3. **OpenAI key:** create at platform.openai.com, add credit, copy to `OPENAI_API_KEY`.
4. **Vercel project:** `vercel link` from `telegram-bot/`, set Root Directory to `telegram-bot/` in Vercel dashboard. Set all envs from `.env.example` in Vercel project settings.
5. **Vercel Blob:** create a Blob store in Vercel dashboard → Storage. Copy the `BLOB_READ_WRITE_TOKEN` into Vercel envs AND into GitHub secrets as `VERCEL_BLOB_RW_TOKEN`.
6. **GitHub secrets** (repo settings → secrets and variables → actions):
   - `FB_MOBILE` = Robin's mobile
   - `FB_PASSWORD_FFF` = FreeForm Fitness FB password
   - `VERCEL_BLOB_RW_TOKEN` = same as Vercel
7. **Deploy:** `vercel deploy --prod` from `telegram-bot/`.
8. **Register webhook:**

       TELEGRAM_BOT_TOKEN=... \
       WEBHOOK_SECRET=... \
       WEBHOOK_URL=https://<your-vercel-domain>/api/webhook \
       node scripts/register-webhook.mjs

9. **Seed first snapshot:** GitHub Actions → "refresh-fitnessboard-export" → "Run workflow". Wait ~5 min. Verify `csv/latest.json` exists in Vercel Blob.

## Smoke test (after deploy)

In Telegram, with the authorized account, send each:

| Message | Expected |
|---|---|
| `/ping` | `pong` |
| `/snapshot` | snapshot date + row counts |
| `/help` | example questions list |
| `how much collected 1 to 7 april?` | should report ₹3,05,700 |
| `cash vs gpay 1-7 april` | ₹2,79,700 cash + ₹26,000 gpay |
| `pt revenue 1-7 april` | ₹1,70,500 |

If any number is wrong, check function logs (`vercel logs`) for the tool call args + result.

## Operational notes

- Refresh runs daily at 06:00 IST. Use `/refresh` to trigger ad-hoc.
- 30 days of snapshots retained in Vercel Blob; older auto-deleted by the cron.
- Logs are in Vercel function logs (retained ~24h on free tier).
- Rate limit: 20 messages / minute / user (in-memory, resets on cold start).
```

- [ ] **Step 2: Commit**

```bash
git add telegram-bot/README.md
git commit -m "docs: bot README with setup, deploy, and smoke test plan"
```

---

## Task 19: Final integration check

- [ ] **Step 1: Run full test suite**

Run: `cd telegram-bot && npm test`
Expected: all green.

- [ ] **Step 2: Typecheck**

Run: `cd telegram-bot && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Verify file tree matches spec section 8**

Run: `cd telegram-bot && find . -type f -not -path './node_modules/*' -not -path './.vercel/*' | sort`
Expected: all files from spec section 8 are present.

- [ ] **Step 4: Confirm commit log**

Run: `git log --oneline -25`
Expected: ~18 commits + the original spec commit.

---

## Out-of-scope, deferred work (matches spec section 15)

- Multi-CSV joins via single tool call.
- Chart/screenshot replies.
- WhatsApp parity.
- EGYM Lokhandwala gym data.
- Persistent audit log to Google Sheet.

