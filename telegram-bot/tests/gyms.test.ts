import { describe, it, expect } from "vitest";
import { GYMS, getGym, listGymSlugs, listGyms, isValidGymSlug } from "../src/gyms.js";

describe("gym registry", () => {
  it("contains freeform and egym", () => {
    const slugs = listGymSlugs();
    expect(slugs).toContain("freeform");
    expect(slugs).toContain("egym");
  });

  it("getGym('freeform') returns the gym with expected fields", () => {
    const g = getGym("freeform");
    expect(g.slug).toBe("freeform");
    expect(g.name).toBe("Free Form Fitness");
    expect(g.passwordEnv).toBe("FB_PASSWORD_FREEFORM");
  });

  it("getGym('egym') returns the gym with expected fields", () => {
    const g = getGym("egym");
    expect(g.slug).toBe("egym");
    expect(g.name).toBe("EGYM Lokhandwala");
    expect(g.passwordEnv).toBe("FB_PASSWORD_EGYM");
  });

  it("getGym throws with valid-list hint on unknown slug", () => {
    expect(() => getGym("nope")).toThrow(/Unknown gym: nope/);
    expect(() => getGym("nope")).toThrow(/Valid: freeform, egym/);
  });

  it("isValidGymSlug acts as a type guard", () => {
    expect(isValidGymSlug("freeform")).toBe(true);
    expect(isValidGymSlug("egym")).toBe(true);
    expect(isValidGymSlug("totallybogus")).toBe(false);
  });

  it("GYMS is non-empty and entries are unique by slug", () => {
    expect(GYMS.length).toBeGreaterThan(0);
    const slugs = GYMS.map(g => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("listGyms returns the full registry in declared order", () => {
    const all = listGyms();
    expect(all.length).toBe(GYMS.length);
    expect(all[0]!.slug).toBe("freeform");
    expect(all[1]!.slug).toBe("egym");
  });
});
