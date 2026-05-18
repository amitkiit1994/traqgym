#!/usr/bin/env node
/**
 * One-time migration: csv/latest.json + csv/YYYY-MM-DD/* → csv/freeform/...
 *
 * Old layout (single-tenant):
 *   csv/latest.json
 *   csv/2026-05-17/payments-<hash>.csv
 *   csv/2026-05-17/members-<hash>.csv
 *
 * New layout (multi-tenant, gym-scoped prefixes):
 *   csv/freeform/latest.json
 *   csv/freeform/2026-05-17/payments-<hash>.csv
 *   csv/freeform/2026-05-17/members-<hash>.csv
 *
 * Strategy: COPY (don't move) — atomic. After verifying the new layout works,
 * a separate cleanup pass deletes the old paths. This run is idempotent —
 * safe to re-run if interrupted (overwrites at target).
 *
 * Required env: BLOB_READ_WRITE_TOKEN
 * Required args: --gym <slug>          target gym slug for migrated data
 *                [--dry-run]            list moves without doing them
 *                [--cleanup]            after a successful copy, delete old paths
 */

import { put, list, del, head } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Read the single source-of-truth gym list (shared with src/gyms.ts) so
// adding a new gym doesn't require editing this script too.
const __dirname = dirname(fileURLToPath(import.meta.url));
const GYMS_JSON_PATH = resolve(__dirname, "../src/gyms.json");
const KNOWN_GYM_SLUGS = JSON.parse(readFileSync(GYMS_JSON_PATH, "utf8")).gyms.map(g => g.slug);

const args = process.argv.slice(2);
const gym = args.includes("--gym") ? args[args.indexOf("--gym") + 1] : undefined;
const dryRun = args.includes("--dry-run");
const cleanup = args.includes("--cleanup");

if (!gym) {
  console.error("Usage: migrate-blob-layout.mjs --gym <slug> [--dry-run] [--cleanup]");
  process.exit(1);
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) { console.error("BLOB_READ_WRITE_TOKEN missing"); process.exit(1); }

console.log(`Migrating legacy csv/* layout → csv/${gym}/*  (dry-run=${dryRun}, cleanup=${cleanup})`);

// 1. Enumerate legacy blobs under csv/ that AREN'T already under csv/<gym>/.
//    Gym slugs come from the shared gyms.json registry (loaded above) so
//    a new gym added to gyms.json automatically participates here too.
const legacy = [];
let cursor;
do {
  const page = await list({ token, prefix: "csv/", cursor, limit: 1000 });
  cursor = page.cursor;
  for (const b of page.blobs) {
    const parts = b.pathname.split("/");
    // Skip if the second segment is a known gym slug → already migrated.
    if (parts.length >= 2 && KNOWN_GYM_SLUGS.includes(parts[1])) continue;
    legacy.push(b);
  }
} while (cursor);

console.log(`Found ${legacy.length} legacy blobs to migrate`);

if (legacy.length === 0) {
  console.log("Nothing to migrate. Exiting.");
  process.exit(0);
}

// 2. For each legacy blob: download bytes, upload at new path, optionally delete old.
let copied = 0, deleted = 0, skipped = 0;
for (const old of legacy) {
  // New pathname: csv/<gym>/<rest-of-path-after-csv/>
  const rest = old.pathname.replace(/^csv\//, "");
  const newPath = `csv/${gym}/${rest}`;

  // The blob URL contains a content-hash suffix on regular blobs (csv/...);
  // latest.json was overwritten in place (addRandomSuffix:false). We need
  // the underlying bytes either way.
  if (dryRun) {
    console.log(`  [DRY] copy ${old.pathname} -> ${newPath}`);
    continue;
  }

  // Download bytes from public URL (latest.json + per-day CSVs are public).
  const res = await fetch(old.url);
  if (!res.ok) {
    console.warn(`  ! failed to read ${old.pathname}: ${res.status}, skipping`);
    skipped++;
    continue;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  // Special case: latest.json contains blob_urls that point at OLD paths.
  // We need to rewrite them to point at the NEW paths too. But the new
  // paths haven't been uploaded yet — we'll fix that in two passes:
  //   pass 1: copy all dated CSVs (this loop, skipping latest.json)
  //   pass 2: rebuild latest.json by re-listing the new csv/<gym>/<date>/ blobs
  if (old.pathname === "csv/latest.json") {
    console.log(`  -- deferring ${old.pathname} (will rebuild after CSV copies)`);
    continue;
  }

  // Detect content type
  const contentType = old.pathname.endsWith(".json") ? "application/json"
    : old.pathname.endsWith(".csv") ? "text/csv"
    : "application/octet-stream";

  const result = await put(newPath, bytes, {
    access: "public",
    contentType,
    token,
    addRandomSuffix: false,    // we want stable paths under new layout
    allowOverwrite: true,
  });
  console.log(`  -> ${newPath}  (${bytes.byteLength} bytes)`);
  copied++;
}

// 3. Rebuild latest.json by re-reading old + remapping URLs.
//    (Each new blob landed at a deterministic path since addRandomSuffix:false above.)
if (!dryRun) {
  const oldLatest = legacy.find(b => b.pathname === "csv/latest.json");
  if (oldLatest) {
    const res = await fetch(oldLatest.url);
    if (res.ok) {
      const oldPointer = await res.json();
      // Re-list new csv/<gym>/<date>/ blobs to discover real new URLs (since
      // addRandomSuffix:false above means same path each time, but URL contains
      // a Vercel-managed hash that changes per upload).
      const newBlobsByName = new Map();
      let c;
      do {
        const page = await list({ token, prefix: `csv/${gym}/`, cursor: c, limit: 1000 });
        c = page.cursor;
        for (const b of page.blobs) {
          // csv/<gym>/<date>/<canonical>.csv → key by canonical (basename without -hash suffix)
          const m = b.pathname.match(/\/([^\/]+)\.csv$/);
          if (m) newBlobsByName.set(m[1], b.url);
        }
      } while (c);

      // Remap blob_urls: keep canonical CSV names, point at new URLs.
      const newUrls = {};
      for (const [name, oldUrl] of Object.entries(oldPointer.blob_urls ?? {})) {
        // The canonical name in pointer is e.g. "payments"; new path is
        // csv/<gym>/<date>/payments.csv (no hash suffix in our migration).
        // Find it in newBlobsByName by exact canonical match.
        if (newBlobsByName.has(name)) {
          newUrls[name] = newBlobsByName.get(name);
        } else {
          console.warn(`  ! pointer references '${name}' but no new blob found`);
        }
      }
      const newLatest = { ...oldPointer, blob_urls: newUrls };
      const result = await put(`csv/${gym}/latest.json`, JSON.stringify(newLatest, null, 2), {
        access: "public",
        contentType: "application/json",
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      console.log(`  -> csv/${gym}/latest.json  (${Object.keys(newUrls).length} CSV refs)`);
      console.log(`  new URL: ${result.url}`);
      copied++;
    }
  }
}

console.log(`\nDone. Copied: ${copied}, skipped: ${skipped}`);

// 4. Optional cleanup pass.
if (cleanup && !dryRun) {
  console.log(`\nCleanup: deleting ${legacy.length} legacy paths...`);
  for (const old of legacy) {
    await del(old.url, { token });
    console.log(`  - deleted ${old.pathname}`);
    deleted++;
  }
  console.log(`Cleanup complete. Deleted: ${deleted}`);
}
