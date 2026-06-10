/**
 * Multi-tenant gym registry.
 *
 * Single source of truth for which gyms the bot knows about. Each gym
 * has a stable `slug` (used in URLs, Blob paths, CSV scopes), a display
 * `name` (shown to humans), and an env-var name for the FitnessBoard
 * password (mobile is shared across all gyms — one owner, multiple
 * gym accounts).
 *
 * Adding a new gym = add an entry here + add the password env var in
 * Vercel + GitHub secrets + redeploy. No other code change needed.
 *
 * Retiring a gym = set `retired: "<YYYY-MM-DD>"` on its entry. Retired
 * gyms are excluded from the ACTIVE roster (listGyms / listGymSlugs /
 * isValidGymSlug — i.e. digest coverage and chat-tool access) but remain
 * resolvable via getGym() so historic snapshots and old briefs keep
 * rendering correct display names. Their blob data is NOT deleted.
 */

export interface Gym {
  /** Stable URL-safe identifier. Used in Blob paths (csv/<slug>/...) */
  slug: string;
  /** Human-readable name. Shown to users + in digest section headers. */
  name: string;
  /** Env var name that holds the FitnessBoard password for this gym. */
  passwordEnv: string;
  /** ISO date the owner stopped operating this gym. Set = excluded from
   *  the active roster; historic data stays resolvable via getGym(). */
  retired?: string;
}

import gymsJson from "./gyms.json" with { type: "json" };

/** Full registry including retired gyms. Use only for historic lookups. */
export const ALL_GYMS: ReadonlyArray<Gym> = (gymsJson.gyms as Gym[]);

// Free Form Fitness ownership cancelled 2026-06-11 - removed from digest roster
// (retired flag in gyms.json). GYMS is the ACTIVE roster: digest, chat tools
// and the scraper all key off this list.
export const GYMS: ReadonlyArray<Gym> = ALL_GYMS.filter(g => !g.retired);

export type GymSlug = (typeof GYMS)[number]["slug"];

/**
 * Lookup a gym by slug — searches the FULL registry (including retired
 * gyms) so post-processing of historic briefs/snapshots never throws.
 * Callers gating live data access should validate with isValidGymSlug()
 * first, which only accepts ACTIVE gyms.
 */
export function getGym(slug: string): Gym {
  const found = ALL_GYMS.find(g => g.slug === slug);
  if (!found) {
    throw new Error(
      `Unknown gym: ${slug}. Valid: ${GYMS.map(g => g.slug).join(", ")}`,
    );
  }
  return found;
}

export function listGymSlugs(): string[] {
  return GYMS.map(g => g.slug);
}

/** Active gyms only — retired gyms are excluded from digest + tools. */
export function listGyms(): ReadonlyArray<Gym> {
  return GYMS;
}

/** True if the slug names an ACTIVE gym. Cheap validation for tool args. */
export function isValidGymSlug(slug: string): slug is GymSlug {
  return GYMS.some(g => g.slug === slug);
}
