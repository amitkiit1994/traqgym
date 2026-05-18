import { describe, it, expect } from "vitest";
import { redactSecrets } from "../src/redact.js";

describe("redactSecrets", () => {
  it("strips GitHub PATs (classic + fine-grained + server tokens)", () => {
    expect(redactSecrets("oops ghp_abcdefghijklmnopqrst leaked")).toBe("oops *** leaked");
    expect(redactSecrets("token=github_pat_11ABCDEFG0_abcdefghijklmnopqrstuv")).toBe("token=***");
    expect(redactSecrets("ghs_abcdefghijklmnopqrstuv")).toBe("***");
    expect(redactSecrets("gho_abcdefghijklmnopqrstuv")).toBe("***");
  });

  it("strips Bearer auth headers", () => {
    expect(redactSecrets('Authorization: Bearer abc.def-ghi_jklmn')).toBe("Authorization: ***");
  });

  it("strips Telegram bot tokens (NNN:XXXX format)", () => {
    expect(redactSecrets("bot1234567:AAEhBP9rabcdefghijklmnopqrstuv99")).toBe("***");
  });

  it("strips OpenAI API keys (sk-...)", () => {
    expect(redactSecrets("key=sk-proj-abcdefghijklmnopqrstuv")).toBe("key=***");
  });

  it("leaves benign text alone", () => {
    expect(redactSecrets("Status 401: Bad request")).toBe("Status 401: Bad request");
    expect(redactSecrets("Total: ₹3,05,700")).toBe("Total: ₹3,05,700");
  });

  it("redacts multiple secrets in one string", () => {
    const s = "ghp_abcdefghijklmnopqrst and Bearer xyz.abc-def-ghi at the same time";
    const out = redactSecrets(s);
    expect(out).not.toContain("ghp_");
    expect(out).not.toContain("Bearer xyz");
    expect(out.match(/\*\*\*/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
