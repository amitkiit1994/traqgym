import { describe, it, expect } from "vitest";
import { ALL_GYMS, GYMS, getGym, listGymSlugs, listGyms, isValidGymSlug } from "../src/gyms.js";

// Free Form Fitness ownership cancelled 2026-06-11 - removed from digest
// roster via the `retired` flag. The ACTIVE roster (GYMS / listGyms /
// isValidGymSlug) must exclude it; getGym must still resolve it so
// historic snapshots and old briefs keep their display names.
describe("gym registry", () => {
  it("active roster contains egym and NOT the retired freeform", () => {
    const slugs = listGymSlugs();
    expect(slugs).toContain("egym");
    expect(slugs).not.toContain("freeform");
  });

  it("full registry still contains freeform, marked retired", () => {
    const fff = ALL_GYMS.find(g => g.slug === "freeform");
    expect(fff).toBeDefined();
    expect(fff!.retired).toBe("2026-06-11");
  });

  it("getGym('freeform') still resolves (historic lookups must not throw)", () => {
    const g = getGym("freeform");
    expect(g.slug).toBe("freeform");
    expect(g.name).toBe("Free Form Fitness");
    expect(g.passwordEnv).toBe("FB_PASSWORD_FREEFORM");
    expect(g.retired).toBe("2026-06-11");
  });

  it("getGym('egym') returns the gym with expected fields", () => {
    const g = getGym("egym");
    expect(g.slug).toBe("egym");
    expect(g.name).toBe("EGYM Lokhandwala");
    expect(g.passwordEnv).toBe("FB_PASSWORD_EGYM");
    expect(g.retired).toBeUndefined();
  });

  it("getGym throws with active-list hint on unknown slug", () => {
    expect(() => getGym("nope")).toThrow(/Unknown gym: nope/);
    expect(() => getGym("nope")).toThrow(/Valid: egym/);
  });

  it("isValidGymSlug accepts only ACTIVE gyms (type guard for tool args)", () => {
    expect(isValidGymSlug("egym")).toBe(true);
    expect(isValidGymSlug("freeform")).toBe(false); // retired
    expect(isValidGymSlug("totallybogus")).toBe(false);
  });

  it("GYMS is non-empty, active-only, and entries are unique by slug", () => {
    expect(GYMS.length).toBeGreaterThan(0);
    expect(GYMS.every(g => !g.retired)).toBe(true);
    const slugs = GYMS.map(g => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("listGyms returns the active roster in declared order", () => {
    const active = listGyms();
    expect(active.length).toBe(GYMS.length);
    expect(active[0]!.slug).toBe("egym");
  });
});
