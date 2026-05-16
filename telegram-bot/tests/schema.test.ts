import { describe, it, expect } from "vitest";
import { QUERY_CSV_DECL, LIST_CSVS_DECL, parseQueryArgs } from "../src/tools/schema.js";

describe("tool declarations (Gemini)", () => {
  it("LIST_CSVS_DECL has the right name", () => {
    expect(LIST_CSVS_DECL.name).toBe("list_csvs");
  });
  it("QUERY_CSV_DECL has required csv arg in JSON schema", () => {
    const schema = QUERY_CSV_DECL.parametersJsonSchema as {
      required: string[];
    };
    expect(schema.required).toContain("csv");
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
