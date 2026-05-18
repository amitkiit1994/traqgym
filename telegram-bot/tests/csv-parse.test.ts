import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, unhealthyColumns } from "../src/data/csv-parse.js";

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

  // EGYM payments CSV comes from XLSX scrape: dates carry a trailing
  // " 00:00:00" the HTML-scraped FFF CSV does not. Strict regex used to
  // turn every date into null, making every date-filtered EGYM query
  // return 0. Keep this fixture in sync with real EGYM blob format.
  it("strips trailing time component from DD-MM-YYYY HH:MM:SS dates", () => {
    const csv =
      "Payment Date,Paid Amount\n" +
      "04-07-2025 00:00:00,3500\n" +
      "15-04-2026T00:00:00,2000\n" +
      "04-07-2025 12:00 AM,1000\n";
    const { rows } = parseCsv(csv, { dateColumns: ["Payment Date"] });
    expect(rows[0]!["Payment Date"]).toBe("2025-07-04");
    expect(rows[1]!["Payment Date"]).toBe("2026-04-15");
    expect(rows[2]!["Payment Date"]).toBe("2025-07-04");
  });

  it("accepts YYYY-MM-DD as a fallback date format", () => {
    const csv = "Payment Date\n2026-04-15\n2026-04-16T08:30:00\n";
    const { rows } = parseCsv(csv, { dateColumns: ["Payment Date"] });
    expect(rows[0]!["Payment Date"]).toBe("2026-04-15");
    expect(rows[1]!["Payment Date"]).toBe("2026-04-16");
  });

  it("coerceNumber strips currency glyphs and treats placeholders as null", () => {
    // Quote fields with embedded commas — CSV-correct shape that matches
    // what FB exports (FFF samples show "1,200" quoted in payments.csv).
    const csv =
      "Amount\n" +
      `"₹1,234"\n` +
      "Rs 5000\n" +
      "NA\n" +
      "--\n" +
      "—\n" +
      "N/A\n" +
      "500.50\n" +
      "1234 INR\n";
    const { rows } = parseCsv(csv, { numberColumns: ["Amount"] });
    expect(rows[0]!.Amount).toBe(1234);
    expect(rows[1]!.Amount).toBe(5000);
    expect(rows[2]!.Amount).toBe(null);
    expect(rows[3]!.Amount).toBe(null);
    expect(rows[4]!.Amount).toBe(null);
    expect(rows[5]!.Amount).toBe(null);
    expect(rows[6]!.Amount).toBe(500.5);
    expect(rows[7]!.Amount).toBe(1234);
  });

  it("reports per-column parse diagnostics (parsed/null/parse_failed/samples)", () => {
    const csv =
      "Payment Date,Paid Amount\n" +
      "01-04-2026,1000\n" +
      "BAD-DATE,xyz\n" +
      ",500\n" +              // blank date is null but not parse-fail
      "02-04-2026,GARBAGE\n";
    const { column_diagnostics } = parseCsv(csv, {
      dateColumns: ["Payment Date"],
      numberColumns: ["Paid Amount"],
    });
    const date = column_diagnostics["Payment Date"]!;
    expect(date.parsed_count).toBe(2);          // rows 0 and 3
    expect(date.parse_failed_count).toBe(1);    // row 1
    expect(date.null_count).toBe(2);            // row 1 (parse-fail null) + row 2 (blank)
    expect(date.sample_bad_values).toContain("BAD-DATE");

    const amt = column_diagnostics["Paid Amount"]!;
    expect(amt.parsed_count).toBe(2);
    expect(amt.parse_failed_count).toBe(2);
    expect(amt.sample_bad_values).toEqual(expect.arrayContaining(["xyz", "GARBAGE"]));
  });

  it("unhealthyColumns flags columns with >5% parse failures", () => {
    // 1 parsed, 1 failed = 50% failure rate → unhealthy.
    const diag = {
      "Payment Date": { parsed_count: 1, null_count: 1, parse_failed_count: 1, sample_bad_values: ["junk"] },
      "Paid Amount":  { parsed_count: 100, null_count: 2, parse_failed_count: 2, sample_bad_values: [] }, // 2% — healthy
    };
    expect(unhealthyColumns(diag)).toEqual(["Payment Date"]);
  });
});
