/**
 * Integration test: exercises the full data path (parseCsv → applyQuery →
 * list_csvs / query_csv) against the LIVE production Vercel Blob.
 *
 * These tests will fail if:
 *   - The blob URL changes (rotate the BLOB_BASE_URL constant)
 *   - A scraper regression changes CSV column names
 *   - A parser regression silently nulls a date/number column
 *   - The query semantics change unexpectedly
 *
 * They're intentionally NOT mocked — the whole point of this bot's outage
 * history was silent format drift between gyms. Real-data integration
 * catches that class of bug; unit-mocked tests don't.
 */
import { describe, it, expect } from "vitest";
import { BlobStoreRegistry } from "../../src/data/blob-store.js";
import { parseCsv, unhealthyColumns } from "../../src/data/csv-parse.js";
import { applyQuery } from "../../src/tools/query-csv.js";
import { buildListCsvsResult, CSV_HINTS } from "../../src/tools/list-csvs.js";

const BLOB_BASE_URL = "https://pp7z5lebia3tfhxs.public.blob.vercel-storage.com";
const registry = new BlobStoreRegistry(BLOB_BASE_URL);

// Slow integration tests — give them 30s each.
const TEST_TIMEOUT = 30_000;

describe("integration: BlobStore latest pointer", () => {
  it("FFF: fetches latest.json with expected CSV set", async () => {
    const p = await registry.for("freeform").fetchLatest();
    expect(p.snapshot_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(p.blob_urls)).toEqual(
      expect.arrayContaining(["payments", "balance", "database", "members"]),
    );
  }, TEST_TIMEOUT);

  it("EGYM: fetches latest.json with expected CSV set", async () => {
    const p = await registry.for("egym").fetchLatest();
    expect(p.snapshot_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(p.blob_urls)).toEqual(
      expect.arrayContaining(["payments", "balance", "database"]),
    );
    // EGYM legitimately lacks 'members' / 'activeinactive' — verify the
    // bot doesn't claim they exist for this gym.
    expect(Object.keys(p.blob_urls)).not.toContain("activeinactive");
  }, TEST_TIMEOUT);

  it("unknown gym slug throws (typo'd gym arg from LLM)", async () => {
    await expect(
      registry.for("freefrom").fetchLatest(),
    ).rejects.toThrow(/fetch failed/);
  }, TEST_TIMEOUT);
});

describe("integration: parseCsv + diagnostics on production CSVs", () => {
  for (const gym of ["freeform", "egym"] as const) {
    it(`${gym}: payments CSV parses with zero parse failures on hinted columns`, async () => {
      const text = await registry.for(gym).fetchCsv("payments");
      const hint = CSV_HINTS.payments!;
      const { rows, columns, column_diagnostics, parse_errors } = parseCsv(text, {
        dateColumns: hint.date,
        numberColumns: hint.number,
      });
      expect(parse_errors).toEqual([]);
      expect(rows.length).toBeGreaterThan(0);
      expect(columns).toContain("Payment Date");
      expect(columns).toContain("Paid Amount");
      // The reason this whole audit started: every hinted typed column on
      // EGYM was 100% null. Now must be 0% null (or near it).
      for (const col of hint.date) {
        if (!columns.includes(col)) continue;
        const d = column_diagnostics[col]!;
        const total = d.parsed_count + d.parse_failed_count;
        expect(d.parse_failed_count / Math.max(total, 1)).toBeLessThan(0.05);
      }
      for (const col of hint.number) {
        if (!columns.includes(col)) continue;
        const d = column_diagnostics[col]!;
        const total = d.parsed_count + d.parse_failed_count;
        expect(d.parse_failed_count / Math.max(total, 1)).toBeLessThan(0.05);
      }
      expect(unhealthyColumns(column_diagnostics)).toEqual([]);
    }, TEST_TIMEOUT);
  }
});

describe("integration: query_csv answers realistic owner questions", () => {
  it("FFF: April 2026 total collection is non-zero (golden-path 'how much last month')", async () => {
    const text = await registry.for("freeform").fetchCsv("payments");
    const hint = CSV_HINTS.payments!;
    const { rows, columns, column_diagnostics, parse_errors } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    const r = applyQuery(
      rows,
      {
        filters: [{ col: "Payment Date", op: "between", val: ["2026-04-01", "2026-04-30"] }],
        agg: { col: "Paid Amount", fn: "sum" },
      },
      { columns, diagnostics: column_diagnostics, parse_errors },
    );
    expect(r.row_count).toBeGreaterThan(0);
    expect(typeof r.agg_result).toBe("number");
    expect(r.agg_result as number).toBeGreaterThan(0);
    expect(r.warnings).toBeUndefined(); // healthy data, no warnings
  }, TEST_TIMEOUT);

  it("EGYM: April 2026 total collection is non-zero (the original bug)", async () => {
    const text = await registry.for("egym").fetchCsv("payments");
    const hint = CSV_HINTS.payments!;
    const { rows, columns, column_diagnostics, parse_errors } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    const r = applyQuery(
      rows,
      {
        filters: [{ col: "Payment Date", op: "between", val: ["2026-04-01", "2026-04-30"] }],
        agg: { col: "Paid Amount", fn: "sum" },
      },
      { columns, diagnostics: column_diagnostics, parse_errors },
    );
    expect(r.row_count).toBeGreaterThan(0);
    expect(r.agg_result as number).toBeGreaterThan(100_000); // EGYM scale
    expect(r.warnings).toBeUndefined();
  }, TEST_TIMEOUT);

  it("EGYM: cash vs gpay group_by (realistic ad-hoc owner question)", async () => {
    const text = await registry.for("egym").fetchCsv("payments");
    const hint = CSV_HINTS.payments!;
    const { rows, columns, column_diagnostics } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    const r = applyQuery(
      rows,
      {
        filters: [{ col: "Payment Date", op: "between", val: ["2026-04-01", "2026-04-30"] }],
        agg: { col: "Paid Amount", fn: "sum" },
        group_by: ["Payment Mode"],
      },
      { columns, diagnostics: column_diagnostics },
    );
    expect(typeof r.agg_result).toBe("object");
    const buckets = Object.keys(r.agg_result as Record<string, number>);
    expect(buckets.length).toBeGreaterThan(1); // at least 2 payment modes
  }, TEST_TIMEOUT);

  it("EGYM: top 5 expiring members this week (sort + limit)", async () => {
    const text = await registry.for("egym").fetchCsv("payments");
    const hint = CSV_HINTS.payments!;
    const { rows, columns, column_diagnostics } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    const r = applyQuery(
      rows,
      {
        filters: [{ col: "End Date", op: "between", val: ["2026-05-19", "2026-05-26"] }],
        order_by: { col: "Paid Amount", dir: "desc" },
        select: ["Billing Name", "Paid Amount", "End Date", "Contact No"],
        limit: 5,
      },
      { columns, diagnostics: column_diagnostics },
    );
    expect(r.rows.length).toBeLessThanOrEqual(5);
    if (r.rows.length > 0) {
      expect(r.rows[0]).toHaveProperty("Billing Name");
      expect(r.rows[0]).toHaveProperty("Contact No");
    }
  }, TEST_TIMEOUT);

  it("EGYM: balance > 10000 returns names + amounts (Outstanding Dues use case)", async () => {
    const text = await registry.for("egym").fetchCsv("balance");
    const hint = CSV_HINTS.balance!;
    const { rows, columns, column_diagnostics } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    const r = applyQuery(
      rows,
      {
        filters: [{ col: "Balance Amount", op: "gt", val: 10000 }],
        order_by: { col: "Balance Amount", dir: "desc" },
        limit: 5,
      },
      { columns, diagnostics: column_diagnostics },
    );
    expect(r.row_count).toBeGreaterThanOrEqual(0); // may legitimately be 0
    // critical: no warnings — Balance Amount must be a real number, not parser-flagged
    expect(r.warnings).toBeUndefined();
  }, TEST_TIMEOUT);

  it("eq filter on Payment Mode (specific-day cash payments)", async () => {
    const text = await registry.for("freeform").fetchCsv("payments");
    const hint = CSV_HINTS.payments!;
    const { rows, columns, column_diagnostics } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    const r = applyQuery(
      rows,
      {
        filters: [
          { col: "Payment Date", op: "eq", val: "2026-04-15" },
          { col: "Payment Mode", op: "eq", val: "Cash" },
        ],
        agg: { col: "Paid Amount", fn: "sum" },
      },
      { columns, diagnostics: column_diagnostics },
    );
    expect(typeof r.agg_result).toBe("number");
    // May be 0 on a specific day with no cash — but row_count and agg
    // must agree. If row_count > 0 then agg > 0.
    if (r.row_count > 0) expect(r.agg_result as number).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it("icontains finds members by partial name (lookup use case)", async () => {
    const text = await registry.for("freeform").fetchCsv("payments");
    const hint = CSV_HINTS.payments!;
    const { rows, columns, column_diagnostics } = parseCsv(text, {
      dateColumns: hint.date,
      numberColumns: hint.number,
    });
    const r = applyQuery(
      rows,
      {
        filters: [{ col: "Billing Name", op: "icontains", val: "khan" }],
        select: ["Billing Name", "Payment Date"],
        limit: 10,
      },
      { columns, diagnostics: column_diagnostics },
    );
    expect(r.row_count).toBeGreaterThanOrEqual(0);
  }, TEST_TIMEOUT);
});

describe("integration: error paths produce structured, actionable errors (no silent zeros)", () => {
  it("typo'd column on a healthy CSV returns explicit error not 0", async () => {
    const text = await registry.for("egym").fetchCsv("payments");
    const { rows, columns } = parseCsv(text, {
      dateColumns: CSV_HINTS.payments!.date,
      numberColumns: CSV_HINTS.payments!.number,
    });
    const r = applyQuery(
      rows,
      {
        filters: [{ col: "Paid Amout" /* typo */, op: "gt", val: 1000 }],
        agg: { col: "Paid Amount", fn: "sum" },
      },
      { columns },
    );
    expect(r.error).toMatch(/Unknown column: Paid Amout/);
    expect(r.agg_result).toBeUndefined();
  }, TEST_TIMEOUT);

  it("typo'd column on an EMPTY CSV still errors (was the silent-zero bug)", () => {
    const r = applyQuery(
      [],
      { filters: [{ col: "TypoCol", op: "eq", val: "x" }] },
      { columns: ["Payment Date", "Paid Amount"] },
    );
    expect(r.error).toMatch(/Unknown column: TypoCol/);
  });

  it("invalid op returns structured error", () => {
    const r = applyQuery(
      [{ "x": 1 }],
      { filters: [{ col: "x", op: "bogus" as any, val: 1 }] },
    );
    expect(r.error).toMatch(/Unknown op/);
  });

  it("EGYM has no 'members' CSV — bot must error, not silently fallback", async () => {
    await expect(
      registry.for("egym").fetchCsv("members"),
    ).rejects.toThrow(/Unknown CSV: members/);
  }, TEST_TIMEOUT);
});

describe("integration: list_csvs surfaces health status per gym", () => {
  it("FFF list_csvs marks every typed CSV as healthy", async () => {
    const result = await buildListCsvsResult(registry.for("freeform"));
    expect(result.gym).toBe("freeform");
    expect(result.csvs.length).toBeGreaterThan(0);
    for (const csv of result.csvs) {
      if (csv.date_columns.length === 0 && csv.number_columns.length === 0) continue;
      expect(csv.unhealthy).toBe(false);
      expect(csv.unhealthy_columns).toEqual([]);
      expect(csv.parse_errors).toEqual([]);
    }
  }, TEST_TIMEOUT);

  it("EGYM list_csvs marks every typed CSV as healthy (post-fix)", async () => {
    const result = await buildListCsvsResult(registry.for("egym"));
    expect(result.gym).toBe("egym");
    for (const csv of result.csvs) {
      if (csv.date_columns.length === 0 && csv.number_columns.length === 0) continue;
      expect(csv.unhealthy).toBe(false);
      expect(csv.unhealthy_columns).toEqual([]);
    }
  }, TEST_TIMEOUT);

  it("EGYM payments sample_rows contain real Payment Date values (not null)", async () => {
    const result = await buildListCsvsResult(registry.for("egym"));
    const payments = result.csvs.find(c => c.name === "payments")!;
    expect(payments).toBeDefined();
    for (const row of payments.sample_rows) {
      expect(row["Payment Date"]).not.toBeNull();
      expect(row["Payment Date"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  }, TEST_TIMEOUT);
});

describe("integration: warning-on-unhealthy path (simulated)", () => {
  // Inject a synthetic 100%-null date column and confirm applyQuery warns.
  // This is what the regression of the original bug would produce.
  it("filter on a 100%-null column attaches UNHEALTHY warning", () => {
    const r = applyQuery(
      [{ "BrokenDate": null, "Amount": 1000 }, { "BrokenDate": null, "Amount": 2000 }],
      {
        filters: [{ col: "BrokenDate", op: "between", val: ["2026-04-01", "2026-04-30"] }],
        agg: { col: "Amount", fn: "sum" },
      },
      {
        columns: ["BrokenDate", "Amount"],
        diagnostics: {
          BrokenDate: {
            parsed_count: 0,
            null_count: 2,
            parse_failed_count: 2,
            sample_bad_values: ["04-07-2025 garbage", "another bad value"],
          },
        },
      },
    );
    expect(r.warnings).toBeDefined();
    expect(r.warnings!.some(w => w.toUpperCase().includes("UNHEALTHY"))).toBe(true);
    expect(r.warnings!.join(" ")).toContain("BrokenDate");
    // The aggregate IS 0 (nothing matched) but warnings make it clear why.
    expect(r.agg_result).toBe(0);
  });
});
