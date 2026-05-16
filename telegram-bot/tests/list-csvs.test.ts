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
    const expected = [
      "payments", "members", "balance", "memberenrollment",
      "activeinactive", "database", "member_details", "sessionreport",
    ];
    for (const name of expected) expect(CSV_HINTS[name]).toBeDefined();
  });
});
