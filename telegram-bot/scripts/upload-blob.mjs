#!/usr/bin/env node
// Usage: node scripts/upload-blob.mjs <csv-dir>
//
// Reads all *.csv files in <csv-dir>, uploads each to Vercel Blob under
// csv/YYYY-MM-DD/<name>.csv, then writes csv/latest.json (atomic swap).
//
// Required env: BLOB_READ_WRITE_TOKEN

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
const DATE_RE = /^csv\/(\d{4}-\d{2}-\d{2})\//;

const dir = process.argv[2];
if (!dir) { console.error("Usage: upload-blob.mjs <csv-dir>"); process.exit(1); }
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

  const result = await put(`csv/${datePart}/${canonical}.csv`, text, {
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

// Snapshot integrity check: refuse to overwrite latest.json if any canonical
// CSV's row count drops by more than 50% from the previous snapshot.
// Guards against stale-cookie scrapes that silently upload login-page junk.
try {
  const head = await list({ token, prefix: "csv/latest.json", limit: 1 });
  const prevBlob = head.blobs[0];
  if (prevBlob) {
    const res = await fetch(prevBlob.url, { cache: "no-store" });
    if (res.ok) {
      const prev = await res.json();
      const drops = [];
      for (const [name, cur] of Object.entries(rowCounts)) {
        const prevCount = prev.row_counts?.[name] ?? 0;
        if (prevCount > 0 && cur < prevCount * 0.5) {
          drops.push(`${name}: ${prevCount} → ${cur}`);
        }
      }
      if (drops.length > 0) {
        console.error("REFUSING to swap latest.json — row counts dropped >50%:");
        for (const d of drops) console.error("  " + d);
        console.error("Likely cause: stale FB cookie. Today's per-CSV blobs were uploaded but latest.json is unchanged.");
        process.exit(2);
      }
    }
  }
} catch (e) {
  console.warn(`Could not fetch previous latest.json for sanity check: ${e.message}`);
}

const latestRes = await put("csv/latest.json", JSON.stringify(latest, null, 2), {
  access: "public",
  contentType: "application/json",
  token,
  addRandomSuffix: false,
  allowOverwrite: true,
});
console.log(`Wrote latest.json: ${latestRes.url}`);

// Retention: delete snapshots older than RETENTION_DAYS
const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
let cursor;
do {
  const page = await list({ token, prefix: "csv/", cursor, limit: 1000 });
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
