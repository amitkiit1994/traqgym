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
});
