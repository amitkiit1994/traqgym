import { vi } from "vitest";

// Mock next/cache so server actions/services that wrap functions with
// `unstable_cache` (or call `revalidatePath`/`revalidateTag`) can be imported
// in a plain Node/vitest context without throwing
// "An attempted call to unstable_cache failed" errors.
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: any[]) => any>(fn: T) => fn,
  unstable_noStore: () => {},
  revalidatePath: () => {},
  revalidateTag: () => {},
}));
