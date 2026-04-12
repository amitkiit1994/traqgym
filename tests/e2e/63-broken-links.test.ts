import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, resolve } from "path";

/**
 * Scans all source files for internal href links (/admin/*, /member/*)
 * and validates they point to actual routes with page.tsx files.
 *
 * This prevents broken links from reaching production.
 */

const ROOT = resolve(__dirname, "../..");
const APP_DIR = join(ROOT, "app");

// Build set of valid routes from app directory
function getValidRoutes(base: string, prefix: string): Set<string> {
  const routes = new Set<string>();
  if (!existsSync(base)) return routes;

  for (const entry of readdirSync(base)) {
    const full = join(base, entry);
    if (!statSync(full).isDirectory()) continue;
    // Skip route groups like (auth)
    if (entry.startsWith("(")) {
      const nested = getValidRoutes(full, prefix);
      nested.forEach((r) => routes.add(r));
      continue;
    }
    const route = `${prefix}/${entry}`;
    routes.add(route);
    // Recurse for nested routes
    const nested = getValidRoutes(full, route);
    nested.forEach((r) => routes.add(r));
  }
  return routes;
}

// Extract all internal hrefs from source files
function findHrefs(dir: string): { file: string; line: number; href: string }[] {
  const results: { file: string; line: number; href: string }[] = [];

  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      // Skip test files
      if (full.includes("/tests/")) continue;

      const content = readFileSync(full, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        // Match href="/admin/..." or href="/member/..."
        const matches = lines[i].matchAll(/href\s*[:=]\s*["'`](\/(admin|member)\/[^"'`\s${]+)["'`]/g);
        for (const match of matches) {
          results.push({
            file: full.replace(ROOT + "/", ""),
            line: i + 1,
            href: match[1],
          });
        }
        // Match router.push("/admin/...") or redirect("/admin/...")
        const pushMatches = lines[i].matchAll(/(?:router\.push|redirect)\s*\(\s*["'`](\/(admin|member)\/[^"'`\s${]+)["'`]/g);
        for (const match of pushMatches) {
          results.push({
            file: full.replace(ROOT + "/", ""),
            line: i + 1,
            href: match[1],
          });
        }
      }
    }
  }

  walk(dir);
  return results;
}

// Normalize href: strip query params, hash, trailing slash, and dynamic segments
function normalizeHref(href: string): string {
  let normalized = href.split("?")[0].split("#")[0].replace(/\/$/, "");
  // Remove dynamic segments like /[id] at the end
  normalized = normalized.replace(/\/\[[^\]]+\]$/, "");
  return normalized;
}

describe("Internal Link Validation", () => {
  const adminRoutes = getValidRoutes(join(APP_DIR, "admin"), "/admin");
  const memberRoutes = getValidRoutes(join(APP_DIR, "member"), "/member");
  const allRoutes = new Set([...adminRoutes, ...memberRoutes]);

  // Also add root member route
  allRoutes.add("/member");

  const hrefs = findHrefs(ROOT);

  it("should have found routes to validate against", () => {
    expect(adminRoutes.size).toBeGreaterThan(30);
    expect(memberRoutes.size).toBeGreaterThan(10);
  });

  it("should have found hrefs to validate", () => {
    expect(hrefs.length).toBeGreaterThan(20);
  });

  it("all internal hrefs should point to valid routes", () => {
    const broken: string[] = [];

    for (const { file, line, href } of hrefs) {
      const normalized = normalizeHref(href);
      if (!allRoutes.has(normalized)) {
        broken.push(`${file}:${line} → ${href} (no route found)`);
      }
    }

    if (broken.length > 0) {
      const msg = `Found ${broken.length} broken link(s):\n${broken.map((b) => `  - ${b}`).join("\n")}`;
      expect.fail(msg);
    }
  });
});
