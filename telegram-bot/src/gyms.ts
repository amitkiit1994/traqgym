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
 */

export interface Gym {
  /** Stable URL-safe identifier. Used in Blob paths (csv/<slug>/...) */
  slug: string;
  /** Human-readable name. Shown to users + in digest section headers. */
  name: string;
  /** Env var name that holds the FitnessBoard password for this gym. */
  passwordEnv: string;
}

import gymsJson from "./gyms.json" with { type: "json" };

export const GYMS: ReadonlyArray<Gym> = (gymsJson.gyms as Gym[]);

export type GymSlug = (typeof GYMS)[number]["slug"];

/** Lookup a gym by slug. Throws if unknown — callers should validate against listGymSlugs() first. */
export function getGym(slug: string): Gym {
  const found = GYMS.find(g => g.slug === slug);
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

export function listGyms(): ReadonlyArray<Gym> {
  return GYMS;
}

/** True if the slug names a registered gym. Cheap validation for tool args. */
export function isValidGymSlug(slug: string): slug is GymSlug {
  return GYMS.some(g => g.slug === slug);
}
