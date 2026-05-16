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
