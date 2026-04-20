/**
 * FitnessBoard → TraqGym Data Migration Script
 *
 * Imports CSV data exported from FitnessBoard v3 into TraqGym's database.
 * Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx scripts/migrate-fitnessboard.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const CSV_DIR = path.resolve(__dirname, "../../competitor-data-export");

// ── Helpers ──────────────────────────────────────────────────────────────────

function readCsv(filename: string): Record<string, string>[] {
  const filepath = path.join(CSV_DIR, filename);
  const content = fs.readFileSync(filepath, "utf-8");
  return parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
}

/**
 * Several CSVs (members, active_inactive, balance) have misaligned columns —
 * the header has "Reg Id"/"Reg. Id" + "Branch Name" as separate columns,
 * but data merges them into one ("Free Form Fitness"). So data has 1 fewer
 * column than headers. We re-parse with corrected headers (dropping "Reg Id").
 */
function readCsvWithFixedHeaders(filename: string, correctedHeaders: string[]): Record<string, string>[] {
  const filepath = path.join(CSV_DIR, filename);
  const content = fs.readFileSync(filepath, "utf-8");
  const raw: string[][] = parse(content, { skip_empty_lines: true, trim: true, relax_column_count: true });
  return raw.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    correctedHeaders.forEach((h, i) => { obj[h] = row[i] || ""; });
    return obj;
  });
}

/** Parse dates in dd-mm-yyyy, dd-mm-yyyy hh:mm:ss, dd-mm-yyyy hh:mm AM/PM, dd Mon yyyy hh:mm:ss:SSS */
function parseDate(raw: string): Date | null {
  if (!raw || raw === "N/a" || raw === "N/A" || raw === "") return null;
  const s = raw.trim();

  // dd Mon yyyy hh:mm:ss:SSS  (e.g. "16 Feb 2026 00:00:00:000")
  const longMatch = s.match(
    /^(\d{1,2})\s+(\w+)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2}):(\d{3})$/
  );
  if (longMatch) {
    const d = new Date(`${longMatch[2]} ${longMatch[1]}, ${longMatch[3]} ${longMatch[4]}:${longMatch[5]}:${longMatch[6]}`);
    if (!isNaN(d.getTime())) return d;
  }

  // dd-mm-yyyy hh:mm AM/PM  (e.g. "08-04-2026 04:18 PM")
  const ampmMatch = s.match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)$/i
  );
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[4]);
    const isPM = ampmMatch[6].toUpperCase() === "PM";
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return new Date(
      parseInt(ampmMatch[3]),
      parseInt(ampmMatch[2]) - 1,
      parseInt(ampmMatch[1]),
      hour,
      parseInt(ampmMatch[5])
    );
  }

  // dd-mm-yyyy hh:mm:ss  (e.g. "08-04-2026 16:14:32")
  const dtMatch = s.match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (dtMatch) {
    return new Date(
      parseInt(dtMatch[3]),
      parseInt(dtMatch[2]) - 1,
      parseInt(dtMatch[1]),
      parseInt(dtMatch[4]),
      parseInt(dtMatch[5]),
      parseInt(dtMatch[6])
    );
  }

  // dd-mm-yyyy  (e.g. "08-04-2026")
  const dateMatch = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dateMatch) {
    return new Date(
      parseInt(dateMatch[3]),
      parseInt(dateMatch[2]) - 1,
      parseInt(dateMatch[1])
    );
  }

  return null;
}

function splitName(name: string): { firstname: string; lastname: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstname: parts[0] || "Member",
    lastname: parts.slice(1).join(" ") || "",
  };
}

function cleanEmail(raw: string): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e === "noemail@gmail.com" || e === "n/a" || e === "" || e === "na") return null;
  return e;
}

function cleanPhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

function parseDecimal(raw: string): number {
  const n = parseFloat(raw.replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function mapPaymentMode(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.includes("cash")) return "cash";
  if (lower.includes("upi") || lower.includes("gpay") || lower.includes("phonepe")) return "upi";
  if (lower.includes("card") || lower.includes("debit") || lower.includes("credit")) return "card";
  if (lower.includes("cheque") || lower.includes("check")) return "cheque";
  if (lower.includes("online") || lower.includes("neft") || lower.includes("bank")) return "bank_transfer";
  return "cash";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== FitnessBoard → TraqGym Migration ===\n");

  // Check if migration already ran
  const marker = await prisma.gymSettings.findUnique({
    where: { key: "fitnessboard_migration_complete" },
  });

  // Read all CSVs
  const allPeople = readCsv("all_people.csv");
  const membersRaw = readCsvWithFixedHeaders("members.csv", [
    "Sr No.", "Branch Name", "Member Id", "Member Name", "Mobile No",
    "Prospect Date", "Payment Date", "Start Date", "End Date",
    "Membership Name", "Membership Status", "Trainer", "Sales Rep",
    "Reciept No", "Membership Cost", "Total Billed Amount", "Discount",
    "Paid Amount", "Balance Amount", "Created On", "Created By",
  ]);
  const paymentsRaw = readCsv("payments.csv");
  const prospectsRaw = readCsv("prospects.csv");
  const balanceRaw = readCsvWithFixedHeaders("balance.csv", [
    "Sr No.", "Branch Name", "Member Id", "Member Name", "Contact No",
    "Balance Amt.", "Next FollowUp Date", "Email Id", "Sales Rep.",
    "Trainer", "Membership", "Billing Owner", "External No.",
    "Prospect Stat", "Purchased Date", "Pending Since",
  ]);
  const callsRaw = readCsv("calls.csv");
  const activeInactive = readCsvWithFixedHeaders("active_inactive.csv", [
    "Sr No.", "Branch Name", "Member Id", "Member Name", "Mobile No",
    "Email Id", "Membership Name", "Start Date", "End Date",
    "Membership Status", "Days Left", "Total Amount", "Paid Amount",
    "Created On", "Created By", "Trainer", "Last Visited On",
  ]);

  console.log(`CSV rows loaded: all_people=${allPeople.length}, members=${membersRaw.length}, payments=${paymentsRaw.length}, prospects=${prospectsRaw.length}, balance=${balanceRaw.length}, calls=${callsRaw.length}, active_inactive=${activeInactive.length}\n`);

  // ── Step 1: Location ──────────────────────────────────────────────────────
  console.log("Step 1: Location...");
  const location = await prisma.location.upsert({
    where: { code: "FFF" },
    update: {},
    create: {
      name: "Free Form Fitness",
      code: "FFF",
      address: "",
      phone: "",
      isActive: true,
    },
  });
  console.log(`  Location: id=${location.id} name="${location.name}"`);

  // ── Step 2: Workers ───────────────────────────────────────────────────────
  console.log("Step 2: Workers...");
  const workerNames = new Set<string>();
  const addWorkerName = (raw: string) => {
    const n = raw?.trim();
    if (n && n !== "" && n !== "N/a" && n !== "N/A") workerNames.add(n);
  };

  for (const row of allPeople) addWorkerName(row["Created By"]);
  for (const row of membersRaw) {
    addWorkerName(row["Trainer"]);
    addWorkerName(row["Sales Rep"]);
    addWorkerName(row["Created By"]);
  }
  for (const row of paymentsRaw) {
    addWorkerName(row["Trainer"]);
    addWorkerName(row["SalesRep"]);
    addWorkerName(row["Created By"]);
  }
  for (const row of prospectsRaw) {
    addWorkerName(row["Sales Rep"]);
    addWorkerName(row["CreatedBy"]);
  }
  for (const row of callsRaw) {
    addWorkerName(row["Call Done By"]);
    addWorkerName(row["Sales Rep"]);
  }
  for (const row of activeInactive) {
    addWorkerName(row["Trainer"]);
    addWorkerName(row["Created By"]);
  }

  const nameToWorkerId = new Map<string, number>();
  const defaultPassword = await bcrypt.hash("password123", 10);

  for (const name of workerNames) {
    const { firstname, lastname } = splitName(name);
    const email = `${firstname.toLowerCase().replace(/\s+/g, "")}${lastname ? "." + lastname.toLowerCase().replace(/\s+/g, "") : ""}@staff.freeform.local`;

    const isAdmin = name.toLowerCase().includes("admin") || name.toLowerCase() === "administrator";

    const worker = await prisma.worker.upsert({
      where: { email },
      update: {},
      create: {
        email,
        password: defaultPassword,
        firstname,
        lastname,
        role: isAdmin ? "admin" : "staff",
        locationId: location.id,
        isActive: true,
      },
    });
    nameToWorkerId.set(name, worker.id);
    // Also map trimmed lowercase for fuzzy matching
    nameToWorkerId.set(name.toLowerCase().trim(), worker.id);
  }
  console.log(`  Workers created/matched: ${nameToWorkerId.size / 2}`);

  // Helper to find worker ID by name
  function findWorkerId(raw: string): number | null {
    if (!raw || raw.trim() === "" || raw === "N/a") return null;
    const name = raw.trim();
    return nameToWorkerId.get(name) ?? nameToWorkerId.get(name.toLowerCase()) ?? null;
  }

  // ── Step 3: TicketPlans ───────────────────────────────────────────────────
  console.log("Step 3: TicketPlans...");
  const planMap = new Map<string, { expireDays: number; price: number }>();

  // From members.csv — has start/end dates + membership cost
  for (const row of membersRaw) {
    const planName = row["Membership Name"]?.trim();
    if (!planName) continue;
    const start = parseDate(row["Start Date"]);
    const end = parseDate(row["End Date"]);
    const cost = parseDecimal(row["Membership Cost"]);

    if (start && end && !planMap.has(planName)) {
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      planMap.set(planName, { expireDays: days, price: cost });
    }
  }

  // From active_inactive.csv — may have additional plan names
  for (const row of activeInactive) {
    const planName = row["Membership Name"]?.trim();
    if (!planName || planMap.has(planName)) continue;
    const start = parseDate(row["Start Date"]);
    const end = parseDate(row["End Date"]);
    const cost = parseDecimal(row["Total Amount"]);

    if (start && end) {
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      planMap.set(planName, { expireDays: days, price: cost });
    }
  }

  const nameToPlanId = new Map<string, number>();
  for (const [planName, info] of planMap) {
    const existing = await prisma.ticketPlan.findFirst({ where: { name: planName } });
    if (existing) {
      nameToPlanId.set(planName, existing.id);
    } else {
      const plan = await prisma.ticketPlan.create({
        data: {
          name: planName,
          price: info.price,
          expireDays: info.expireDays,
          isActive: true,
        },
      });
      nameToPlanId.set(planName, plan.id);
    }
  }
  console.log(`  Plans created/matched: ${nameToPlanId.size}`);

  // ── Step 4: Users ─────────────────────────────────────────────────────────
  console.log("Step 4: Users...");

  // Build prospect enrichment data from prospects.csv (keyed by phone)
  const prospectEnrichment = new Map<string, Record<string, string>>();
  for (const row of prospectsRaw) {
    const phone = cleanPhone(row["Contact"]);
    if (phone) prospectEnrichment.set(phone, row);
  }

  const phoneToUserId = new Map<string, number>();
  const fbIdToUserId = new Map<string, number>();
  let userCount = 0;

  for (const row of allPeople) {
    const phone = cleanPhone(row["Contact No."]);
    // Relaxed from `< 10` so legacy short phones (e.g. Nitin's 9-digit
    // 554490110) survive instead of dropping the user + every payment that
    // joins on phone. Numbers with < 7 digits are still treated as junk.
    if (!phone || phone.length < 7) continue;
    if (phoneToUserId.has(phone)) {
      // Deduplicate by phone
      fbIdToUserId.set(row["Prospect Id"], phoneToUserId.get(phone)!);
      continue;
    }

    const { firstname, lastname } = splitName(row["Name"]);
    const rawEmail = cleanEmail(row["Email"]);
    const email = rawEmail || `${phone}@imported.local`;
    const hashedPassword = await bcrypt.hash(phone, 10);

    // Enrich from prospects.csv if available
    const enrichment = prospectEnrichment.get(phone);
    const altPhone = enrichment?.["Alternate No"]?.trim();
    const address = enrichment?.["Prospect Address"]?.trim();
    const occupation = enrichment?.["Occupation"]?.trim();
    const anniversaryRaw = enrichment?.["Anniversary Date"]?.trim();
    const aadhar = enrichment?.["Aadhar Card"]?.trim();
    const pan = enrichment?.["PAN Card"]?.trim();

    const anniversaryDate = parseDate(anniversaryRaw || "");
    const govtId = (aadhar || pan) ? JSON.stringify({
      ...(aadhar && aadhar !== "" && aadhar !== "N/a" ? { aadhar } : {}),
      ...(pan && pan !== "" && pan !== "N/a" ? { pan } : {}),
    }) : null;
    // Only set govtId if it has actual content
    const govtIdFinal = govtId && govtId !== "{}" ? govtId : null;

    const gender = row["Gender"]?.toLowerCase().trim() || enrichment?.["Gender"]?.toLowerCase().trim() || null;
    const dob = enrichment?.["DOB"] ? parseDate(enrichment["DOB"]) : null;
    // Skip sentinel DOB "01-01-1900"
    const birthdate = dob && dob.getFullYear() > 1900 ? dob : null;

    // Preserve historical signup date so cohort/MoM reports aren't all
    // collapsed onto the import date. Falls back to undefined => Prisma
    // default of now() for rows without "Created On".
    const createdAtRaw = parseDate(row["Created On"] || "");

    const existing = await prisma.user.findUnique({ where: { email } });
    let userId: number;
    if (existing) {
      userId = existing.id;
    } else {
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstname,
          lastname,
          phone,
          gender,
          birthdate,
          locationId: location.id,
          isActive: true,
          alternatePhone: (altPhone && altPhone !== "N/a" && altPhone !== "") ? altPhone : null,
          address: (address && address !== "N/a" && address !== "") ? address : null,
          occupation: (occupation && occupation !== "N/a" && occupation !== "") ? occupation : null,
          anniversaryDate,
          govtId: govtIdFinal,
          createdAt: createdAtRaw || undefined,
        },
      });
      userId = user.id;
      userCount++;
    }

    phoneToUserId.set(phone, userId);
    fbIdToUserId.set(row["Prospect Id"], userId);
  }
  console.log(`  Users created: ${userCount}, total mapped: ${phoneToUserId.size}`);

  // ── Step 5: MemberTickets ─────────────────────────────────────────────────
  console.log("Step 5: MemberTickets...");

  // Build externalRef map from balance.csv (keyed by member id)
  const externalRefMap = new Map<string, string>();
  for (const row of balanceRaw) {
    const extNo = row["External No."]?.trim();
    const memberId = row["Member Id"]?.trim();
    if (extNo && extNo !== "" && memberId) {
      externalRefMap.set(memberId, extNo);
    }
  }

  let ticketCount = 0;
  // Track created tickets for payment matching: key = `${userId}-${startDate}-${planName}`
  const ticketLookup = new Map<string, number>();

  for (const row of membersRaw) {
    const phone = cleanPhone(row["Mobile No"]);
    const userId = phoneToUserId.get(phone);
    if (!userId) {
      // Member not in all_people — try to find or create
      continue;
    }

    const planName = row["Membership Name"]?.trim();
    const planId = planName ? nameToPlanId.get(planName) : null;
    if (!planId) continue;

    const startDate = parseDate(row["Start Date"]);
    const endDate = parseDate(row["End Date"]);
    if (!startDate || !endDate) continue;

    const totalAmount = parseDecimal(row["Total Billed Amount"]);
    const paidAmount = parseDecimal(row["Paid Amount"]);
    const balanceAmount = parseDecimal(row["Balance Amount"]);

    const statusRaw = row["Membership Status"]?.toLowerCase().trim();
    const status = statusRaw === "active" ? "active" : "cancelled";

    // Check for duplicate ticket (in-memory + DB)
    const ticketKey = `${userId}-${startDate.toISOString()}-${planId}`;
    if (ticketLookup.has(ticketKey)) continue;

    const existingTicket = await prisma.memberTicket.findFirst({
      where: { userId, planId, buyDate: startDate },
    });
    if (existingTicket) {
      ticketLookup.set(ticketKey, existingTicket.id);
      continue;
    }

    // Get externalRef from balance.csv if available
    const fbMemberId = row["Reg. Id"]?.trim() || "";
    const externalRef = externalRefMap.get(fbMemberId) || null;

    const ticket = await prisma.memberTicket.create({
      data: {
        userId,
        planId,
        locationId: location.id,
        buyDate: startDate,
        expireDate: endDate,
        status,
        totalAmount,
        amountPaid: paidAmount,
        balanceDue: balanceAmount,
        externalRef,
      },
    });

    ticketLookup.set(ticketKey, ticket.id);
    ticketCount++;
  }
  console.log(`  MemberTickets created: ${ticketCount}`);

  // ── Step 6: Payments ──────────────────────────────────────────────────────
  console.log("Step 6: Payments + Invoices...");
  let paymentCount = 0;

  // We need a fallback worker for collectedById
  const fallbackWorkerId = nameToWorkerId.values().next().value!;

  for (const row of paymentsRaw) {
    const fbMemberId = row["MemberId"]?.trim();
    const phone = cleanPhone(row["Contact No"]);
    const userId = fbIdToUserId.get(fbMemberId) ?? phoneToUserId.get(phone);
    if (!userId) continue;

    const amount = parseDecimal(row["Paid Amount"]);
    // Don't drop zero-amount rows — they represent comp passes / waived
    // joining fees that owner needs to see in the comp ledger. Negative
    // amounts (rare; refunds in source) are still skipped.
    if (amount < 0) continue;

    const paymentDate = parseDate(row["Payment Date"]) || parseDate(row["Created On"]);
    const invoiceNo = row["InvoiceNo"]?.trim();
    // Zero-amount rows are comps — overwrite mode so the dashboard cash/UPI
    // filters and the comp-auditor agent both classify them correctly.
    const paymentMode = amount === 0 ? "complimentary" : mapPaymentMode(row["Payment Mode"]);
    const discount = parseDecimal(row["Discount"]);
    const paymentFor = row["Payment For"]?.trim() || null;
    const remarks = row["Remarks"]?.trim() || null;

    // Find matching ticket
    const planName = row["MembershipName"]?.trim();
    const startDate = parseDate(row["StartDate"]);
    const planId = planName ? nameToPlanId.get(planName) : null;

    let memberTicketId: number | null = null;
    if (planId && startDate) {
      const key = `${userId}-${startDate.toISOString()}-${planId}`;
      memberTicketId = ticketLookup.get(key) ?? null;
    }
    // Fallback: find any ticket for this user
    if (!memberTicketId) {
      const anyTicket = await prisma.memberTicket.findFirst({
        where: { userId },
        orderBy: { buyDate: "desc" },
      });
      if (anyTicket) memberTicketId = anyTicket.id;
      else continue; // No ticket to attach to
    }

    const collectedById = findWorkerId(row["Created By"]) ?? findWorkerId(row["SalesRep"]) ?? fallbackWorkerId;

    // Check for duplicate payment by invoice number
    const fbInvoice = `FB-${invoiceNo}`;
    const existingInvoice = invoiceNo
      ? await prisma.invoice.findFirst({ where: { invoiceNumber: fbInvoice } })
      : null;
    if (existingInvoice) continue;

    const payment = await prisma.payment.create({
      data: {
        userId,
        memberTicketId,
        locationId: location.id,
        amount,
        paymentMode,
        paymentNote: remarks,
        collectedById,
        discount: discount > 0 ? discount : null,
        paymentFor,
        createdAt: paymentDate || undefined,
      },
    });

    // Step 7: Invoice
    if (invoiceNo) {
      await prisma.invoice.create({
        data: {
          invoiceNumber: fbInvoice,
          userId,
          paymentId: payment.id,
          route: "membership",
          status: "paid",
          createdAt: paymentDate || undefined,
        },
      });
    }

    paymentCount++;
  }
  console.log(`  Payments + Invoices created: ${paymentCount}`);

  // ── Step 8: Enquiries ─────────────────────────────────────────────────────
  console.log("Step 8: Enquiries...");
  let enquiryCount = 0;

  const phoneToEnquiryId = new Map<string, number>();

  for (const row of prospectsRaw) {
    const phone = cleanPhone(row["Contact"]);
    if (!phone) continue;

    const name = row["Name"]?.trim() || "Unknown";
    const rawEmail = cleanEmail(row["Email Id"]);
    const email = rawEmail || `${phone}@prospect.local`;

    const sourceMap: Record<string, string> = {
      "advertisement": "advertisement",
      "passing by": "passing_by",
      "walk in": "walk_in",
      "phone": "phone_enquiry",
      "referral": "referral",
      "social media": "social_media",
      "website": "website",
    };
    const rawSource = row["Prospect Source"]?.toLowerCase().trim() || "";
    const source = sourceMap[rawSource] || rawSource || "walk_in";

    const prospectType = row["Prospect Type"]?.trim() || null;
    const referredBy = row["Referred By"]?.trim() || null;

    // Check for existing enquiry
    const existing = await prisma.enquiry.findFirst({ where: { phone } });
    if (existing) {
      phoneToEnquiryId.set(phone, existing.id);
      continue;
    }

    const enquiry = await prisma.enquiry.create({
      data: {
        name,
        phone,
        email,
        source,
        locationId: location.id,
        status: "new",
        prospectType: (prospectType && prospectType !== "N/a") ? prospectType : null,
        referredByName: (referredBy && referredBy !== "") ? referredBy : null,
        createdAt: parseDate(row["Prospect Date"]) || undefined,
      },
    });

    phoneToEnquiryId.set(phone, enquiry.id);
    enquiryCount++;
  }
  console.log(`  Enquiries created: ${enquiryCount}`);

  // ── Step 9: EnquiryFollowups ──────────────────────────────────────────────
  console.log("Step 9: EnquiryFollowups...");
  let enquiryFollowupCount = 0;

  for (const row of callsRaw) {
    const phone = cleanPhone(row["Contact No"]);
    const enquiryId = phoneToEnquiryId.get(phone);
    if (!enquiryId) continue; // Only process calls linked to prospects

    const workerId = findWorkerId(row["Call Done By"]) ?? findWorkerId(row["Sales Rep"]) ?? fallbackWorkerId;
    const callDate = parseDate(row["Call Date"]);
    const nextFollowup = parseDate(row["Next Followup Date"]);
    const comments = row["Comments"]?.trim() || null;
    const callResponse = row["Call Response"]?.trim()?.toLowerCase() || "";

    // Map call response to outcome
    let outcome = "callback";
    if (callResponse.includes("interested")) outcome = "interested";
    else if (callResponse.includes("not interested")) outcome = "not_interested";
    else if (callResponse.includes("no answer") || callResponse.includes("not reachable")) outcome = "no_answer";
    else if (callResponse.includes("visited")) outcome = "visited";
    else if (callResponse.includes("converted")) outcome = "converted";

    // Dedup check
    const existingEF = callDate ? await prisma.enquiryFollowup.findFirst({
      where: { enquiryId, createdAt: callDate },
    }) : null;
    if (existingEF) continue;

    await prisma.enquiryFollowup.create({
      data: {
        enquiryId,
        workerId,
        action: "call",
        outcome,
        notes: comments,
        nextFollowupAt: nextFollowup,
        createdAt: callDate || undefined,
      },
    });
    enquiryFollowupCount++;
  }
  console.log(`  EnquiryFollowups created: ${enquiryFollowupCount}`);

  // ── Step 10: PaymentFollowups ─────────────────────────────────────────────
  console.log("Step 10: PaymentFollowups...");
  let payFollowupCount = 0;

  for (const row of balanceRaw) {
    const phone = cleanPhone(row["Contact No"]);
    const userId = phoneToUserId.get(phone);
    if (!userId) continue;

    const balanceAmt = parseDecimal(row["Balance Amt."]);
    if (balanceAmt <= 0) continue;

    const nextFollowup = parseDate(row["Next FollowUp Date"]);
    const purchasedDate = parseDate(row["Purchased Date"]);
    const assignedToId = findWorkerId(row["Sales Rep."]) ?? findWorkerId(row["Trainer"]);

    // Dedup check
    const existingPF = await prisma.paymentFollowup.findFirst({
      where: { userId, amountDue: balanceAmt },
    });
    if (existingPF) continue;

    // Find matching ticket
    const ticket = await prisma.memberTicket.findFirst({
      where: { userId, balanceDue: { gt: 0 } },
      orderBy: { buyDate: "desc" },
    });

    await prisma.paymentFollowup.create({
      data: {
        userId,
        memberTicketId: ticket?.id ?? null,
        amountDue: balanceAmt,
        dueDate: purchasedDate || new Date(),
        assignedToId,
        status: "pending",
        priority: "normal",
        nextFollowupAt: nextFollowup,
      },
    });
    payFollowupCount++;
  }

  // Also create PaymentFollowups from calls.csv for members (not prospects)
  for (const row of callsRaw) {
    const phone = cleanPhone(row["Contact No"]);
    if (phoneToEnquiryId.has(phone)) continue; // Already handled as EnquiryFollowup
    const userId = phoneToUserId.get(phone);
    if (!userId) continue;

    const expectedAmount = parseDecimal(row["Expected Amount"]);
    const callDate = parseDate(row["Call Date"]);
    const nextFollowup = parseDate(row["Next Followup Date"]);
    const callSubject = row["Call Subject"]?.trim() || null;
    const reason = row["Reason"]?.trim() || null;
    const comments = row["Comments"]?.trim() || null;
    const assignedToId = findWorkerId(row["Call Done By"]) ?? findWorkerId(row["Sales Rep"]);

    // Dedup check
    const existingCallPF = callDate ? await prisma.paymentFollowup.findFirst({
      where: { userId, lastContactedAt: callDate },
    }) : null;
    if (existingCallPF) continue;

    const ticket = await prisma.memberTicket.findFirst({
      where: { userId },
      orderBy: { buyDate: "desc" },
    });

    await prisma.paymentFollowup.create({
      data: {
        userId,
        memberTicketId: ticket?.id ?? null,
        amountDue: expectedAmount > 0 ? expectedAmount : 0,
        dueDate: callDate || new Date(),
        assignedToId,
        status: "pending",
        priority: row["Priority"]?.toLowerCase().trim() || "normal",
        notes: comments,
        callSubject,
        reason,
        nextFollowupAt: nextFollowup,
        lastContactedAt: callDate,
      },
    });
    payFollowupCount++;
  }
  console.log(`  PaymentFollowups created: ${payFollowupCount}`);

  // ── Mark migration complete ───────────────────────────────────────────────
  await prisma.gymSettings.upsert({
    where: { key: "fitnessboard_migration_complete" },
    update: { value: new Date().toISOString() },
    create: { key: "fitnessboard_migration_complete", value: new Date().toISOString() },
  });

  console.log("\n=== Migration complete ===");
  console.log(`Location: 1, Workers: ${workerNames.size}, Plans: ${nameToPlanId.size}`);
  console.log(`Users: ${phoneToUserId.size}, Tickets: ${ticketCount}, Payments: ${paymentCount}`);
  console.log(`Enquiries: ${enquiryCount}, EnquiryFollowups: ${enquiryFollowupCount}, PaymentFollowups: ${payFollowupCount}`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
