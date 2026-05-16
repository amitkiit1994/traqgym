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
