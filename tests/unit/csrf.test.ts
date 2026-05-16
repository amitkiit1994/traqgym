import { describe, it, expect } from "vitest";
import { checkOrigin } from "@/lib/services/csrf";

describe("checkOrigin", () => {
  it("allows matching origin/host", () => {
    const req = new Request("https://gym.traqgym.com/api/x", {
      method: "POST",
      headers: {
        origin: "https://gym.traqgym.com",
        host: "gym.traqgym.com",
      },
    });
    const r = checkOrigin(req);
    expect(r.ok).toBe(true);
  });

  it("blocks mismatched origin", () => {
    const req = new Request("https://gym.traqgym.com/api/x", {
      method: "POST",
      headers: {
        origin: "https://attacker.example.com",
        host: "gym.traqgym.com",
      },
    });
    const r = checkOrigin(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/mismatch/i);
      expect(r.error).toContain("attacker.example.com");
    }
  });

  it("blocks when origin header is missing", () => {
    const req = new Request("https://gym.traqgym.com/api/x", {
      method: "POST",
      headers: {
        host: "gym.traqgym.com",
        // no origin
      },
    });
    const r = checkOrigin(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/missing/i);
    }
  });
});
