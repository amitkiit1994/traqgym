import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "fs";

const prisma = new PrismaClient();
const DIR = "/Users/amitkumardas/freeformOS/freeformfitnessOS/egymlokhandwala-data-export";

function readCsv(f: string): any[] {
  return parse(fs.readFileSync(`${DIR}/${f}`, "utf-8"), {
    columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
  });
}

function stripTrainerSuffix(raw: string) {
  let s = raw.trim();
  const isExternal = /external\s*trainer/i.test(s);
  s = s.replace(/\bexternal\s*trainer\b/gi, "")
       .replace(/\bin\s*house\s*trainer\b/gi, "")
       .replace(/\bin\s*house\s*personal\s*trainer\b/gi, "")
       .replace(/\bfloor\s*trainers?\b/gi, "")
       .replace(/\s+/g, " ").trim();
  return { name: s, isExternal };
}
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
const SKIP = new Set(["", "administrator", "floor trainer", "floor trainers"]);

async function main() {
  const payments = readCsv("FINAL_payments_all.csv");
  const packages = readCsv("FINAL_packages.csv");

  // 1. CSV trainer signal counts
  let csvTrainerRows = 0;
  let csvSkippedByName = 0;
  const distinctRaw = new Map<string, number>();
  const distinctNorm = new Map<string, number>();
  for (const r of payments) {
    const raw = r["Trainer"]?.trim() ?? "";
    if (!raw) continue;
    csvTrainerRows++;
    distinctRaw.set(raw, (distinctRaw.get(raw) ?? 0) + 1);
    const { name } = stripTrainerSuffix(raw);
    const norm = normalizeName(name);
    if (SKIP.has(norm)) { csvSkippedByName++; continue; }
    distinctNorm.set(norm, (distinctNorm.get(norm) ?? 0) + 1);
  }
  console.log(`CSV payments with non-empty Trainer: ${csvTrainerRows}`);
  console.log(`  Skipped by SKIP_TRAINERS rule: ${csvSkippedByName}`);
  console.log(`  Distinct raw trainer strings: ${distinctRaw.size}`);
  console.log(`  Distinct normalized names: ${distinctNorm.size}`);

  // 2. Worker matching
  const workers = await prisma.worker.findMany({ select: { id: true, firstname: true, lastname: true } });
  const wmap = new Map<string, number>();
  for (const w of workers) {
    const full = normalizeName(`${w.firstname ?? ""} ${w.lastname ?? ""}`.trim());
    if (full) wmap.set(full, w.id);
    const fn = normalizeName(w.firstname ?? "");
    if (fn && !wmap.has(fn)) wmap.set(fn, w.id);
  }
  const unmatched: { name: string; count: number }[] = [];
  for (const [norm, count] of distinctNorm) {
    if (!wmap.has(norm)) unmatched.push({ name: norm, count });
  }
  console.log(`\nUnmatched trainer names (no Worker found):`);
  for (const u of unmatched) console.log(`  "${u.name}" — ${u.count} payment(s)`);

  // 3. Why 3232 - 2953 = 279 missing? Sources of payment-update misses:
  let csvNoInvoiceNo = 0;
  let csvSkipName = 0;
  let csvNoWorkerMatch = 0;
  let csvInvoiceNotInDb = 0;
  let csvPaymentMissing = 0;
  let csvAlreadyHadTrainer = 0;
  let csvWouldUpdate = 0;
  const planMeta = new Map<string, { sessions: number; isPt: boolean }>();
  for (const row of packages) {
    const name = row["Membership Name"]?.trim() ?? "";
    if (!name) continue;
    const cat = (row["Membership Category"] ?? "").toLowerCase();
    const sessions = parseInt(row["Sessions"] ?? "0", 10) || 0;
    const isPt = /personal training|opt/.test(cat) || /\bpt\b|opt|personal/i.test(name);
    planMeta.set(name.toLowerCase(), { sessions, isPt });
  }

  // Aggregate trainer stats first (mirroring real script)
  const trainerStats = new Map<string, { workerId: number | null; isExternal: boolean }>();
  for (const r of payments) {
    const raw = r["Trainer"]?.trim() ?? "";
    if (!raw) continue;
    const { name, isExternal } = stripTrainerSuffix(raw);
    const norm = normalizeName(name);
    if (SKIP.has(norm)) continue;
    const wid = wmap.get(norm) ?? null;
    const cur = trainerStats.get(norm) ?? { workerId: wid, isExternal: false };
    if (isExternal) cur.isExternal = true;
    trainerStats.set(norm, cur);
  }

  let ptCsvRows = 0;
  let ptInvoiceMissing = 0;
  let ptPlanNotMarked = 0;
  let ptPlanNotInMap = 0;
  for (const r of payments) {
    const inv = r["InvoiceNo"]?.trim();
    const raw = r["Trainer"]?.trim() ?? "";
    if (!inv) { csvNoInvoiceNo++; continue; }
    if (!raw) continue;
    const { name } = stripTrainerSuffix(raw);
    const norm = normalizeName(name);
    if (SKIP.has(norm)) { csvSkipName++; continue; }
    const stat = trainerStats.get(norm);
    if (!stat?.workerId) { csvNoWorkerMatch++; continue; }
    csvWouldUpdate++;

    // PT analysis
    const planName = (r["MembershipName"] ?? "").trim().toLowerCase();
    if (planName) {
      const meta = planMeta.get(planName);
      if (!meta) ptPlanNotInMap++;
      else if (meta.isPt) ptCsvRows++;
      else ptPlanNotMarked++;
    }
  }
  console.log(`\nWould-update payments (had trainer + Worker match): ${csvWouldUpdate}`);
  console.log(`  Skipped: noInvoiceNo=${csvNoInvoiceNo}, skipName=${csvSkipName}, noWorkerMatch=${csvNoWorkerMatch}`);
  console.log(`\nCSV PT rows breakdown:`);
  console.log(`  PT-plan rows (would create PtPackage): ${ptCsvRows}`);
  console.log(`  Non-PT plan rows: ${ptPlanNotMarked}`);
  console.log(`  Plan name not found in package map: ${ptPlanNotInMap}`);

  // 4. Why DB has 2953 not csvWouldUpdate? Check invoice lookup hit rate
  const sample = payments.filter((r: any) => r["Trainer"]?.trim() && r["InvoiceNo"]?.trim()).slice(0, 50);
  let hits = 0, misses = 0;
  for (const r of sample) {
    const inv = await prisma.invoice.findFirst({ where: { invoiceNumber: `EGL-${r["InvoiceNo"]}` }, select: { id: true } });
    if (inv) hits++; else misses++;
  }
  console.log(`\nInvoice lookup sample (first 50 trainer rows): hits=${hits} misses=${misses}`);
}

main().finally(() => prisma.$disconnect());
