// llm.ts is now powered by the OpenAI Agents SDK which does its own HTTP calls.
// A faithful unit test would require either a real OpenAI key (slow, $$$) or
// a deep mock of the Agents SDK runner — both fragile. We rely on:
//   - unit tests for the underlying primitives (query-csv, list-csvs, schema)
//   - end-to-end smoke tests against the deployed bot
import { describe, it, expect } from "vitest";

describe("runLlm", () => {
  it.skip("integration-tested via deployed bot smoke tests, not unit-mocked", () => {
    expect(true).toBe(true);
  });
});
