#!/usr/bin/env node
// Usage: node scripts/upload-blob.mjs <csv-dir> --gym <slug>
//
// Reads all *.csv files in <csv-dir>, uploads each to Vercel Blob under
// csv/<gym>/YYYY-MM-DD/<name>.csv, then writes csv/<gym>/latest.json
// (atomic swap).
//
// Required env: BLOB_READ_WRITE_TOKEN
// Required arg: --gym <slug>  (e.g. freeform, egym)

import { put, list, del } from "@vercel/blob";
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";

// FB export filename → canonical CSV name used in latest.json
const NAME_MAP = {
  "export_payment_all":          "payments",
  "export_database_all":         "database",
  "export_balance_all":          "balance",
  "export_memberenrollment_all": "memberenrollment",
  "export_activeinactive_all":   "activeinactive",
  "member_details_all":          "member_details",
  "ajax_memberships_Data1":      "members",
  "page_sessionreport":          "sessionreport",
};
const RETENTION_DAYS = 30;
// Match csv/<gym>/YYYY-MM-DD/...
const DATE_RE = /^csv\/[^/]+\/(\d{4}-\d{2}-\d{2})\//;

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith("--"));
const gymIdx = args.indexOf("--gym");
const gym = gymIdx >= 0 ? args[gymIdx + 1] : undefined;
if (!dir || !gym) {
  console.error("Usage: upload-blob.mjs <csv-dir> --gym <slug>");
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(gym)) {
  console.error(`Invalid gym slug: '${gym}' (must be lowercase alphanumeric + dashes)`);
  process.exit(1);
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) { console.error("BLOB_READ_WRITE_TOKEN missing"); process.exit(1); }

const today = new Date();
const datePart = today.toISOString().slice(0, 10);
const istIso = new Date(today.getTime() + 5.5 * 3600 * 1000)
  .toISOString()
  .replace("Z", "+05:30");

const files = (await readdir(dir)).filter(f => f.toLowerCase().endsWith(".csv"));
const urls = {};
const rowCounts = {};

for (const file of files) {
  const stem = basename(file, extname(file));
  const canonical = NAME_MAP[stem];
  if (!canonical) {
    console.log(`Skipping ${file} (no mapping)`);
    continue;
  }
  const full = resolve(dir, file);
  const text = await readFile(full, "utf8");
  rowCounts[canonical] = Math.max(
    0,
    text.split(/\r?\n/).filter(l => l.length > 0).length - 1,
  );

  const result = await put(`csv/${gym}/${datePart}/${canonical}.csv`, text, {
    access: "public",
    contentType: "text/csv",
    token,
    addRandomSuffix: true,
    allowOverwrite: false,
  });
  urls[canonical] = result.url;
  console.log(`Uploaded ${canonical}: ${result.url}`);
}

const latest = {
  snapshot_date: datePart,
  snapshot_ist: istIso,
  row_counts: rowCounts,
  blob_urls: urls,
};

// Snapshot integrity check: refuse to overwrite this gym's latest.json
// if any CRITICAL CSV's row count drops by more than 50% from the
// previous snapshot. Guards against stale-cookie scrapes that silently
// upload login-page junk.
//
// Critical = the CSVs the digest + bot lean on most heavily. We do NOT
// gate on best-effort enrichment CSVs (member_details, sessionreport)
// because those may legitimately partial-fail under time budgets without
// indicating a bad scrape.
const CRITICAL = new Set(["payments", "database", "balance", "members",
                          "memberenrollment", "activeinactive"]);
// Run the integrity check. Any failure of THIS step that we can't classify
// as "first ever upload" (404) is treated as fatal — we used to swallow
// every error and proceed, which meant a 401 / network blip on the prior
// pointer could let us swap in a corrupt new one without any check.
const head = await list({ token, prefix: `csv/${gym}/latest.json`, limit: 1 });
const prevBlob = head.blobs[0];
if (prevBlob) {
  const res = await fetch(prevBlob.url, { cache: "no-store" });
  if (res.status === 404) {
    // First upload after blob deletion / new gym slug — nothing to compare to.
    console.warn(`No previous latest.json found at ${prevBlob.url} (404). Skipping sanity check.`);
  } else if (!res.ok) {
    // 401, 403, 5xx — we cannot verify, so do NOT swap. Failing loud beats
    // silently shipping a possibly-corrupt pointer.
    console.error(`Sanity check failed: GET previous latest.json returned ${res.status}.`);
    console.error("Refusing to swap latest.json — would risk overwriting good data with unverified new data.");
    process.exit(2);
  } else {
    const prev = await res.json();
    const drops = [];
    const partials = [];
    const missingCritical = [];
    // Catches CSVs that were present yesterday but entirely missing today —
    // a stronger blindspot than the "row count dropped >50%" check, which
    // can't see a CSV that wasn't produced at all.
    for (const name of Object.keys(prev.row_counts ?? {})) {
      if (!(name in rowCounts) && CRITICAL.has(name)) {
        missingCritical.push(`${name}: present yesterday (${prev.row_counts[name]} rows), missing today`);
      }
    }
    for (const [name, cur] of Object.entries(rowCounts)) {
      const prevCount = prev.row_counts?.[name] ?? 0;
      if (prevCount > 0 && cur < prevCount * 0.5) {
        if (CRITICAL.has(name)) drops.push(`${name}: ${prevCount} → ${cur}`);
        else partials.push(`${name}: ${prevCount} → ${cur}`);
      }
    }
    if (partials.length > 0) {
      console.warn("Partial fetch on non-critical CSVs (proceeding):");
      for (const p of partials) console.warn("  " + p);
      // GitHub Actions workflow-warning annotation — surfaces in the run UI.
      console.log(`::warning::Partial fetch on non-critical CSVs: ${partials.join(", ")}`);
    }
    if (drops.length > 0 || missingCritical.length > 0) {
      console.error("REFUSING to swap latest.json — critical CSVs dropped >50% or went missing:");
      for (const d of drops) console.error("  " + d);
      for (const m of missingCritical) console.error("  " + m);
      console.error("Likely cause: stale FB cookie or scraper crash. Per-CSV blobs uploaded but latest.json is unchanged.");
      process.exit(2);
    }
  }
}

const latestRes = await put(`csv/${gym}/latest.json`, JSON.stringify(latest, null, 2), {
  access: "public",
  contentType: "application/json",
  token,
  addRandomSuffix: false,
  allowOverwrite: true,
  // CDN cache 0 — latest.json MUST always serve fresh. Per-day CSV blobs
  // are immutable (random suffix) so they can be cached normally.
  cacheControlMaxAge: 0,
});
console.log(`Wrote latest.json: ${latestRes.url}`);

// Retention: delete this gym's snapshots older than RETENTION_DAYS.
// (Each gym manages its own retention — we don't touch other gyms' blobs.)
const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
let cursor;
do {
  const page = await list({ token, prefix: `csv/${gym}/`, cursor, limit: 1000 });
  cursor = page.cursor;
  for (const blob of page.blobs) {
    const m = blob.pathname.match(DATE_RE);
    if (!m) continue;
    const blobDate = Date.parse(`${m[1]}T00:00:00Z`);
    if (blobDate < cutoff) {
      await del(blob.url, { token });
      console.log(`Deleted old snapshot: ${blob.pathname}`);
    }
  }
} while (cursor);
