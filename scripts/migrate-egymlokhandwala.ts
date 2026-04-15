/**
 * E-Gym Lokhandwala (FitnessBoard) → TraqGym Data Migration Script
 *
 * Imports CSV data exported from FitnessBoard v3 into TraqGym's database.
 * Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx scripts/migrate-egymlokhandwala.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const CSV_DIR = path.resolve(__dirname, "../egymlokhandwala-data-export");

// ── Helpers ──────────────────────────────────────────────────────────────────

function readCsv(filename: string): Record<string, string>[] {
  const filepath = path.join(CSV_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`  WARN: ${filename} not found, skipping`);
    return [];
  }
  const content = fs.readFileSync(filepath, "utf-8");
  return parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
}

/** Parse dates in dd-mm-yyyy, dd-mm-yyyy hh:mm AM/PM, dd-mm-yyyy hh:mm:ss, dd Mon yyyy hh:mm:ss:SSS, yyyy-mm-dd */
function parseDate(raw: string): Date | null {
  if (!raw || raw === "N/a" || raw === "N/A" || raw === "No Details" || raw === "No Data" || raw === "") return null;
  const s = raw.trim();

  // yyyy-mm-dd (from API data)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const d = new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    if (!isNaN(d.getTime())) return d;
  }

  // dd Mon yyyy hh:mm:ss:SSS (e.g. "22 Jun 2015 00:00:00:000")
  const longMatch = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2}):(\d{3})$/);
  if (longMatch) {
    const d = new Date(`${longMatch[2]} ${longMatch[1]}, ${longMatch[3]} ${longMatch[4]}:${longMatch[5]}:${longMatch[6]}`);
    if (!isNaN(d.getTime())) return d;
  }

  // dd-mm-yyyy hh:mm AM/PM (e.g. "08-04-2026 04:18 PM")
  const ampmMatch = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[4]);
    const isPM = ampmMatch[6].toUpperCase() === "PM";
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return new Date(parseInt(ampmMatch[3]), parseInt(ampmMatch[2]) - 1, parseInt(ampmMatch[1]), hour, parseInt(ampmMatch[5]));
  }

  // dd-mm-yyyy hh:mm:ss (e.g. "22-06-2015 00:00:00")
  const dtMatch = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (dtMatch) {
    return new Date(parseInt(dtMatch[3]), parseInt(dtMatch[2]) - 1, parseInt(dtMatch[1]), parseInt(dtMatch[4]), parseInt(dtMatch[5]), parseInt(dtMatch[6]));
  }

  // dd-mm-yyyy hh:mm:ss AM/PM (e.g. "02-01-2026 01:20 PM") — without seconds
  // Already handled above. Also handle "05-11-2015 12:00 AM"
  const ampmMatch2 = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (ampmMatch2) {
    let hour = parseInt(ampmMatch2[4]);
    const isPM = ampmMatch2[7].toUpperCase() === "PM";
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return new Date(parseInt(ampmMatch2[3]), parseInt(ampmMatch2[2]) - 1, parseInt(ampmMatch2[1]), hour, parseInt(ampmMatch2[5]), parseInt(ampmMatch2[6]));
  }

  // dd-mm-yyyy (e.g. "08-04-2026")
  const dateMatch = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dateMatch) {
    return new Date(parseInt(dateMatch[3]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[1]));
  }

  // dd-Mon-yyyy (e.g. "01-Jan-1994")
  const monMatch = s.match(/^(\d{2})-(\w+)-(\d{4})$/);
  if (monMatch) {
    const d = new Date(`${monMatch[2]} ${monMatch[1]}, ${monMatch[3]}`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function splitName(name: string): { firstname: string; lastname: string } {
  const parts = name.trim().split(/\s+/);
  return { firstname: parts[0] || "Member", lastname: parts.slice(1).join(" ") || "" };
}

function cleanEmail(raw: string): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e === "noemail@gmail.com" || e === "n/a" || e === "" || e === "na") return null;
  if (!e.includes("@")) return null;
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

function isBlank(val: string | undefined): boolean {
  return !val || val.trim() === "" || val === "N/a" || val === "N/A" || val === "No Details" || val === "No Data";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== E-Gym Lokhandwala → TraqGym Migration ===\n");

  // Read all CSVs
  const database = readCsv("FINAL_database_all.csv");
  const memberDetails = readCsv("FINAL_member_details_all.csv");
  const memberships = readCsv("FINAL_memberships_all.csv");
  const payments = readCsv("FINAL_payments_all.csv");
  const balance = readCsv("FINAL_balance.csv");
  const calls = readCsv("FINAL_calls.csv");
  const activeInactive = readCsv("FINAL_activeinactive.csv");
  const packages = readCsv("FINAL_packages.csv");
  const staff = readCsv("FINAL_staff.csv");

  console.log(`CSV rows: database=${database.length}, memberDetails=${memberDetails.length}, memberships=${memberships.length}, payments=${payments.length}, balance=${balance.length}, calls=${calls.length}, activeInactive=${activeInactive.length}, packages=${packages.length}, staff=${staff.length}\n`);

  // Build member details enrichment map (keyed by MemberId)
  const detailsById = new Map<string, Record<string, string>>();
  for (const row of memberDetails) {
    const mid = row["MemberId"]?.trim();
    if (mid) detailsById.set(mid, row);
  }

  // ── Step 1: Location ──────────────────────────────────────────────────────
  console.log("Step 1: Location...");
  const location = await prisma.location.upsert({
    where: { code: "EGL" },
    update: {},
    create: {
      name: "E-Gym - Lokhandwala",
      code: "EGL",
      address: "Lokhandwala, Andheri West, Mumbai",
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
    if (n && !isBlank(n)) workerNames.add(n);
  };

  // From staff list
  for (const row of staff) addWorkerName(row["Name"]);
  // From database export
  for (const row of database) addWorkerName(row["Created By"]);
  // From memberships
  for (const row of memberships) addWorkerName(row["Created By"] || "");
  // From payments
  for (const row of payments) {
    addWorkerName(row["Trainer"]);
    addWorkerName(row["SalesRep"]);
    addWorkerName(row["Created By"]);
  }
  // From active/inactive
  for (const row of activeInactive) {
    addWorkerName(row["Trainer"]);
    addWorkerName(row["Created By"]);
  }
  // From calls
  for (const row of calls) addWorkerName(row["Created By"]);
  // From balance
  for (const row of balance) {
    addWorkerName(row["Sales Rep."]);
    addWorkerName(row["Trainer"]);
  }

  const nameToWorkerId = new Map<string, number>();
  const defaultPassword = await bcrypt.hash("password123", 10);

  for (const name of workerNames) {
    const { firstname, lastname } = splitName(name);
    const email = `${firstname.toLowerCase().replace(/[^a-z0-9]/g, "")}${lastname ? "." + lastname.toLowerCase().replace(/[^a-z0-9]/g, "") : ""}@staff.egym.local`;
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
    nameToWorkerId.set(name.toLowerCase().trim(), worker.id);
  }
  console.log(`  Workers created/matched: ${workerNames.size}`);

  function findWorkerId(raw: string): number | null {
    if (!raw || isBlank(raw)) return null;
    const name = raw.trim();
    return nameToWorkerId.get(name) ?? nameToWorkerId.get(name.toLowerCase()) ?? null;
  }

  // ── Step 3: TicketPlans ───────────────────────────────────────────────────
  console.log("Step 3: TicketPlans...");
  const nameToPlanId = new Map<string, number>();

  // From FINAL_packages.csv (authoritative plan catalog)
  for (const row of packages) {
    const planName = row["Membership Name"]?.trim();
    if (!planName) continue;
    const expireDays = Math.max(1, parseInt(row["Duration Day)"] || "30"));
    const price = parseDecimal(row["Price"]);

    const existing = await prisma.ticketPlan.findFirst({ where: { name: planName } });
    if (existing) {
      nameToPlanId.set(planName, existing.id);
    } else {
      const plan = await prisma.ticketPlan.create({
        data: { name: planName, price, expireDays, isActive: row["Status"]?.toLowerCase() !== "inactive" },
      });
      nameToPlanId.set(planName, plan.id);
    }
  }

  // Also discover plans from memberships data (may have legacy plans not in catalog)
  for (const row of memberships) {
    const planName = row["Package Name"]?.trim();
    if (!planName || nameToPlanId.has(planName)) continue;
    const start = parseDate(row["Start Date"]);
    const end = parseDate(row["End Date"]);
    const cost = parseDecimal(row["MemberShip Cost"]);
    if (start && end) {
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      const plan = await prisma.ticketPlan.create({
        data: { name: planName, price: cost, expireDays: days, isActive: false },
      });
      nameToPlanId.set(planName, plan.id);
    }
  }

  // From active/inactive (may have more plan names)
  for (const row of activeInactive) {
    const planName = row["Membership Name"]?.trim();
    if (!planName || nameToPlanId.has(planName)) continue;
    const start = parseDate(row["Start Date"]);
    const end = parseDate(row["End Date"]);
    const cost = parseDecimal(row["Total Amount"]);
    if (start && end) {
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      const plan = await prisma.ticketPlan.create({
        data: { name: planName, price: cost, expireDays: days, isActive: false },
      });
      nameToPlanId.set(planName, plan.id);
    }
  }

  // From database export "Last Membership Name" (catch any remaining)
  for (const row of database) {
    const planName = row["Last Membership Name"]?.trim();
    if (!planName || nameToPlanId.has(planName)) continue;
    const start = parseDate(row["Start Date"]);
    const end = parseDate(row["End Date"]);
    const cost = parseDecimal(row["Membership Amount"]);
    if (start && end) {
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      const plan = await prisma.ticketPlan.create({
        data: { name: planName, price: cost, expireDays: days, isActive: false },
      });
      nameToPlanId.set(planName, plan.id);
    }
  }

  console.log(`  Plans created/matched: ${nameToPlanId.size}`);

  // ── Step 4: Users ─────────────────────────────────────────────────────────
  console.log("Step 4: Users...");
  const phoneToUserId = new Map<string, number>();
  const fbIdToUserId = new Map<string, number>();
  let userCount = 0;

  for (const row of database) {
    const phone = cleanPhone(row["Mobile No"]);
    if (!phone || phone.length < 10) continue;
    if (phoneToUserId.has(phone)) {
      fbIdToUserId.set(row["Prospect Id"], phoneToUserId.get(phone)!);
      continue;
    }

    const { firstname, lastname } = splitName(row["Prospect Name"]);
    const rawEmail = cleanEmail(row["Email"]);
    const email = rawEmail || `${phone}@imported.local`;
    const hashedPassword = await bcrypt.hash(phone, 10);

    // DOB from database export, skip sentinel "01-01-1900"
    const dob = parseDate(row["Date of Birth"]);
    const birthdate = dob && dob.getFullYear() > 1900 ? dob : null;

    // Gender
    const gender = row["Gender"]?.toLowerCase().trim() || undefined;

    // Alt phone
    const altPhone = row["Alternative No."]?.trim();

    // Address
    const address = row["Prospect Address"]?.trim();

    // Govt ID (Aadhar / Pan)
    const aadhar = row["Aadhar Card"]?.trim();
    const pan = row["Pan Card"]?.trim();
    const govtId = (aadhar && !isBlank(aadhar)) || (pan && !isBlank(pan))
      ? JSON.stringify({
          ...(aadhar && !isBlank(aadhar) ? { aadhar } : {}),
          ...(pan && !isBlank(pan) ? { pan } : {}),
        })
      : null;
    const govtIdFinal = govtId && govtId !== "{}" ? govtId : null;

    // Enrich from API member details if available
    const fbId = row["Prospect Id"]?.trim();
    const detail = detailsById.get(fbId);
    const occupation = detail?.["Occupation"]?.trim();
    const whatsapp = detail?.["Whatsapp"]?.trim();

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
          gender: gender === "male" || gender === "female" ? gender : undefined,
          birthdate,
          locationId: location.id,
          isActive: true,
          alternatePhone: !isBlank(altPhone) ? altPhone : undefined,
          address: !isBlank(address) ? address : undefined,
          occupation: !isBlank(occupation) ? occupation : undefined,
          govtId: govtIdFinal,
        },
      });
      userId = user.id;
      userCount++;
    }

    phoneToUserId.set(phone, userId);
    fbIdToUserId.set(row["Prospect Id"], userId);
  }
  console.log(`  Users created from database: ${userCount}, mapped: ${phoneToUserId.size}`);

  // ── Step 4b: Create missing users from memberships/payments/activeinactive ──
  console.log("Step 4b: Users from memberships/payments/activeinactive...");
  let extraUserCount = 0;

  // Collect all phones + names from memberships, payments, activeinactive, balance
  const extraSources: { phone: string; name: string; email?: string; memberId?: string }[] = [];

  for (const row of memberships) {
    const phone = cleanPhone(row["Contact No"]);
    const name = row["Name"]?.trim();
    const mid = row["Member Id"]?.trim();
    if (phone && phone.length >= 10 && name) extraSources.push({ phone, name, memberId: mid });
  }
  for (const row of activeInactive) {
    const phone = cleanPhone(row["Mobile No"]);
    const name = row["Member Name"]?.trim();
    const email = cleanEmail(row["Email Id"]) || undefined;
    const mid = row["Member Id"]?.trim();
    if (phone && phone.length >= 10 && name) extraSources.push({ phone, name, email, memberId: mid });
  }
  for (const row of payments) {
    const phone = cleanPhone(row["Contact No"]);
    const name = row["Member Name"]?.trim();
    const mid = row["MemberId"]?.trim();
    if (phone && phone.length >= 10 && name) extraSources.push({ phone, name, memberId: mid });
  }
  for (const row of balance) {
    const phone = cleanPhone(row["Contact No"]);
    const name = row["Member Name"]?.trim();
    const mid = row["Member Id"]?.trim();
    if (phone && phone.length >= 10 && name) extraSources.push({ phone, name, memberId: mid });
  }

  for (const src of extraSources) {
    if (phoneToUserId.has(src.phone)) {
      // Still map memberId if we have one
      if (src.memberId) fbIdToUserId.set(src.memberId, phoneToUserId.get(src.phone)!);
      continue;
    }

    const { firstname, lastname } = splitName(src.name);
    const email = src.email || `${src.phone}@imported.local`;
    const hashedPassword = await bcrypt.hash(src.phone, 10);

    // Enrich from member_details if available
    const detail = src.memberId ? detailsById.get(src.memberId) : undefined;
    const gender = detail?.["Gender"]?.toLowerCase().trim();
    const dob = detail ? parseDate(detail["DOB"] || "") : null;
    const birthdate = dob && dob.getFullYear() > 1900 ? dob : null;
    const address = detail?.["Address"]?.trim();
    const occupation = detail?.["Occupation"]?.trim();

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
          phone: src.phone,
          gender: gender === "male" || gender === "female" ? gender : undefined,
          birthdate,
          locationId: location.id,
          isActive: true,
          address: !isBlank(address) ? address : undefined,
          occupation: !isBlank(occupation) ? occupation : undefined,
        },
      });
      userId = user.id;
      extraUserCount++;
    }

    phoneToUserId.set(src.phone, userId);
    if (src.memberId) fbIdToUserId.set(src.memberId, userId);
  }
  console.log(`  Extra users created: ${extraUserCount}, total mapped: ${phoneToUserId.size}`);

  // ── Step 5: MemberTickets ─────────────────────────────────────────────────
  console.log("Step 5: MemberTickets...");
  let ticketCount = 0;
  const ticketLookup = new Map<string, number>();

  // Build memberId→phone map from memberships CSV
  const memberIdToPhone = new Map<string, string>();
  for (const row of memberships) {
    const mid = row["Member Id"]?.trim();
    const phone = cleanPhone(row["Contact No"]);
    if (mid && phone) memberIdToPhone.set(mid, phone);
  }

  for (const row of memberships) {
    const phone = cleanPhone(row["Contact No"]);
    const userId = phoneToUserId.get(phone);
    if (!userId) continue;

    const planName = row["Package Name"]?.trim();
    const planId = planName ? nameToPlanId.get(planName) : null;
    if (!planId) continue;

    const startDate = parseDate(row["Start Date"]);
    const endDate = parseDate(row["End Date"]);
    if (!startDate || !endDate) continue;

    const totalAmount = parseDecimal(row["Purchase Cost"]);
    const membershipCost = parseDecimal(row["MemberShip Cost"]);
    const discount = parseDecimal(row["Discount"]);
    const statusRaw = row["Membership Status"]?.toLowerCase().trim();
    const status = statusRaw === "active" ? "active" : "cancelled";

    const ticketKey = `${userId}-${startDate.toISOString()}-${planId}`;
    if (ticketLookup.has(ticketKey)) continue;

    const existingTicket = await prisma.memberTicket.findFirst({
      where: { userId, planId, buyDate: startDate },
    });
    if (existingTicket) {
      ticketLookup.set(ticketKey, existingTicket.id);
      continue;
    }

    const ticket = await prisma.memberTicket.create({
      data: {
        userId,
        planId,
        locationId: location.id,
        buyDate: startDate,
        expireDate: endDate,
        status,
        totalAmount: totalAmount || membershipCost,
        amountPaid: totalAmount,
        balanceDue: 0,
      },
    });

    ticketLookup.set(ticketKey, ticket.id);
    ticketCount++;
  }
  console.log(`  MemberTickets created: ${ticketCount}`);

  // ── Step 5b: Create fallback plan for misc payments ────────────────────────
  // Some payments belong to users with no membership ticket (POS, misc, etc.)
  let miscPlan = await prisma.ticketPlan.findFirst({ where: { name: "Imported - Misc" } });
  if (!miscPlan) {
    miscPlan = await prisma.ticketPlan.create({
      data: { name: "Imported - Misc", price: 0, expireDays: 365, isActive: false },
    });
  }

  // ── Step 6: Payments + Invoices ───────────────────────────────────────────
  console.log("Step 6: Payments + Invoices...");
  let paymentCount = 0;
  let fallbackTicketCount = 0;
  const fallbackWorkerId = nameToWorkerId.values().next().value!;
  const userFallbackTicket = new Map<number, number>(); // userId → fallback ticketId

  for (const row of payments) {
    const fbMemberId = row["MemberId"]?.trim();
    const phone = cleanPhone(row["Contact No"]);
    const userId = fbIdToUserId.get(fbMemberId) ?? phoneToUserId.get(phone);
    if (!userId) continue;

    const amount = parseDecimal(row["Paid Amount"]);
    if (amount <= 0) continue;

    const paymentDate = parseDate(row["Payment Date"]) || parseDate(row["Created On"]);
    const invoiceNo = row["InvoiceNo"]?.trim();
    const paymentMode = mapPaymentMode(row["Payment Mode"]);
    const discount = parseDecimal(row["Discount"]);
    const paymentFor = row["Payment For"]?.trim() || undefined;
    const remarks = row["Remarks"]?.trim() || undefined;

    // Find matching ticket
    const planName = row["MembershipName"]?.trim();
    const startDate = parseDate(row["StartDate"]);
    const planId = planName ? nameToPlanId.get(planName) : null;

    let memberTicketId: number | null = null;
    if (planId && startDate) {
      const key = `${userId}-${startDate.toISOString()}-${planId}`;
      memberTicketId = ticketLookup.get(key) ?? null;
    }
    if (!memberTicketId) {
      const anyTicket = await prisma.memberTicket.findFirst({
        where: { userId },
        orderBy: { buyDate: "desc" },
      });
      if (anyTicket) {
        memberTicketId = anyTicket.id;
      } else {
        // Create a fallback ticket so the payment can be linked
        if (userFallbackTicket.has(userId)) {
          memberTicketId = userFallbackTicket.get(userId)!;
        } else {
          const fbTicket = await prisma.memberTicket.create({
            data: {
              userId,
              planId: miscPlan.id,
              locationId: location.id,
              buyDate: paymentDate || new Date(),
              expireDate: paymentDate ? new Date(paymentDate.getTime() + 365 * 24 * 60 * 60 * 1000) : new Date(),
              status: "cancelled",
              totalAmount: 0,
              amountPaid: 0,
              balanceDue: 0,
            },
          });
          memberTicketId = fbTicket.id;
          userFallbackTicket.set(userId, fbTicket.id);
          fallbackTicketCount++;
        }
      }
    }

    const collectedById = findWorkerId(row["Created By"]) ?? findWorkerId(row["SalesRep"]) ?? fallbackWorkerId;

    // Dedup by invoice number
    const fbInvoice = `EGL-${invoiceNo}`;
    if (invoiceNo) {
      const existingInvoice = await prisma.invoice.findFirst({ where: { invoiceNumber: fbInvoice } });
      if (existingInvoice) continue;
    }

    const payment = await prisma.payment.create({
      data: {
        userId,
        memberTicketId,
        locationId: location.id,
        amount,
        paymentMode,
        paymentNote: !isBlank(remarks) ? remarks : undefined,
        collectedById,
        discount: discount > 0 ? discount : undefined,
        paymentFor: !isBlank(paymentFor) ? paymentFor : undefined,
        createdAt: paymentDate || undefined,
      },
    });

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
  console.log(`  Payments + Invoices created: ${paymentCount} (${fallbackTicketCount} fallback tickets for ticketless users)`);

  // ── Step 6b: Update ticket balanceDue from balance.csv ─────────────────────
  console.log("Step 6b: Balance due updates...");
  let balanceUpdated = 0;
  for (const row of balance) {
    const phone = cleanPhone(row["Contact No"]);
    const userId = phoneToUserId.get(phone);
    if (!userId) continue;

    const balanceAmt = parseDecimal(row["Balance Amt."]);
    if (balanceAmt <= 0) continue;

    // Find the most recent ticket and update its balanceDue
    const ticket = await prisma.memberTicket.findFirst({
      where: { userId },
      orderBy: { buyDate: "desc" },
    });
    if (ticket && ticket.balanceDue === 0) {
      await prisma.memberTicket.update({
        where: { id: ticket.id },
        data: { balanceDue: balanceAmt, amountPaid: ticket.totalAmount - balanceAmt },
      });
      balanceUpdated++;
    }
  }
  console.log(`  Balance due updated on ${balanceUpdated} tickets`);

  // ── Step 6c: Update ticket status from activeinactive.csv ────────────────
  console.log("Step 6c: Active/inactive status sync...");
  let statusUpdated = 0;
  for (const row of activeInactive) {
    const phone = cleanPhone(row["Mobile No"]);
    const userId = phoneToUserId.get(phone);
    if (!userId) continue;

    const membershipStatus = row["Membership Status"]?.toLowerCase().trim();
    const endDate = parseDate(row["End Date"]);
    const startDate = parseDate(row["Start Date"]);
    const planName = row["Membership Name"]?.trim();
    const planId = planName ? nameToPlanId.get(planName) : undefined;

    // Find the matching ticket
    let ticket = planId && startDate
      ? await prisma.memberTicket.findFirst({ where: { userId, planId, buyDate: startDate } })
      : null;
    if (!ticket) {
      ticket = await prisma.memberTicket.findFirst({ where: { userId }, orderBy: { buyDate: "desc" } });
    }

    if (ticket) {
      const newStatus = membershipStatus === "active" ? "active" : "cancelled";
      if (ticket.status !== newStatus) {
        await prisma.memberTicket.update({
          where: { id: ticket.id },
          data: { status: newStatus, expireDate: endDate || ticket.expireDate },
        });
        statusUpdated++;
      }
    }
  }
  console.log(`  Status corrected on ${statusUpdated} tickets`);

  // ── Step 7: Enquiries ─────────────────────────────────────────────────────
  console.log("Step 7: Enquiries...");
  let enquiryCount = 0;
  const phoneToEnquiryId = new Map<string, number>();

  // Prospects are members with status "Prospect" in the database export
  for (const row of database) {
    const status = row["Prospect Status"]?.trim();
    if (status !== "Prospect") continue;

    const phone = cleanPhone(row["Mobile No"]);
    if (!phone || phone.length < 10) continue;
    if (phoneToEnquiryId.has(phone)) continue;

    const name = row["Prospect Name"]?.trim() || "Unknown";
    const rawEmail = cleanEmail(row["Email"]);
    const email = rawEmail || undefined;

    const sourceMap: Record<string, string> = {
      "advertisement": "advertisement",
      "passing by": "passing_by",
      "walk in": "walk_in",
      "phone": "phone_enquiry",
      "referral": "referral",
      "social media": "social_media",
      "website": "website",
      "old enquiries": "walk_in",
      "otherold member": "walk_in",
    };
    const rawSource = row["Prospect Source"]?.toLowerCase().trim() || "";
    const source = sourceMap[rawSource] || "walk_in";

    const prospectType = row["Prospect Type"]?.trim() || undefined;
    const referredBy = row["Reffered By"]?.trim() || undefined;

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
        prospectType: !isBlank(prospectType) ? prospectType : undefined,
        referredByName: !isBlank(referredBy) ? referredBy : undefined,
        createdAt: parseDate(row["Prospect Date"]) || undefined,
      },
    });

    phoneToEnquiryId.set(phone, enquiry.id);
    enquiryCount++;
  }
  console.log(`  Enquiries created: ${enquiryCount}`);

  // ── Step 8: PaymentFollowups ──────────────────────────────────────────────
  console.log("Step 8: PaymentFollowups...");
  let payFollowupCount = 0;

  // From balance.csv — outstanding balances
  for (const row of balance) {
    const phone = cleanPhone(row["Contact No"]);
    const userId = phoneToUserId.get(phone);
    if (!userId) continue;

    const balanceAmt = parseDecimal(row["Balance Amt."]);
    if (balanceAmt <= 0) continue;

    const nextFollowup = parseDate(row["Next FollowUp Date"]);
    const purchasedDate = parseDate(row["Purchased Date"]);
    const assignedToId = findWorkerId(row["Sales Rep."]) ?? findWorkerId(row["Trainer"]);

    const existingPF = await prisma.paymentFollowup.findFirst({
      where: { userId, amountDue: balanceAmt },
    });
    if (existingPF) continue;

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

  // From calls — member follow-ups (not prospect enquiries)
  // Calls data has MemberId, not phone — build MemberId→userId map
  const fbMemberIdToUserId = new Map<string, number>();
  for (const row of database) {
    const fbId = row["Prospect Id"]?.trim();
    if (fbId && fbIdToUserId.has(fbId)) {
      fbMemberIdToUserId.set(fbId, fbIdToUserId.get(fbId)!);
    }
  }

  for (const row of calls) {
    const memberId = row["MemberId"]?.trim();
    if (!memberId) continue;

    const userId = fbMemberIdToUserId.get(memberId);
    if (!userId) continue;

    const callDate = parseDate(row["Call Date"]);
    const assignedToId = findWorkerId(row["Created By"]);
    const callRegarding = row["Call Regarding"]?.trim() || undefined;
    const callResponse = row["Call Response"]?.trim() || undefined;

    // Dedup
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
        amountDue: 0,
        dueDate: callDate || new Date(),
        assignedToId,
        status: "pending",
        priority: row["Priority"]?.toLowerCase().trim() || "normal",
        callSubject: !isBlank(callRegarding) ? callRegarding : undefined,
        notes: !isBlank(callResponse) ? callResponse : undefined,
        lastContactedAt: callDate,
      },
    });
    payFollowupCount++;
  }
  console.log(`  PaymentFollowups created: ${payFollowupCount}`);

  // ── Mark migration complete ───────────────────────────────────────────────
  await prisma.gymSettings.upsert({
    where: { key: "egymlokhandwala_migration_complete" },
    update: { value: new Date().toISOString() },
    create: { key: "egymlokhandwala_migration_complete", value: new Date().toISOString() },
  });

  console.log("\n=== Migration complete ===");
  console.log(`Location: 1, Workers: ${workerNames.size}, Plans: ${nameToPlanId.size}`);
  console.log(`Users: ${phoneToUserId.size}, Tickets: ${ticketCount}, Payments: ${paymentCount}`);
  console.log(`Enquiries: ${enquiryCount}, PaymentFollowups: ${payFollowupCount}`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
