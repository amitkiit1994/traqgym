"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";

export type SearchResultItem = {
  id: number;
  label: string;
  sublabel: string;
  category: "member" | "worker" | "plan" | "class" | "enquiry";
  href: string;
};

export async function globalSearch(query: string): Promise<SearchResultItem[]> {
  try { await requireWorker(); } catch { return []; }
  if (!query || query.length < 2) return [];

  const q = query.trim();
  const results: SearchResultItem[] = [];

  // Members
  const members = await prisma.user.findMany({
    where: {
      OR: [
        { firstname: { contains: q, mode: "insensitive" } },
        { lastname: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    select: { id: true, firstname: true, lastname: true, email: true, phone: true },
    take: 5,
  });
  for (const m of members) {
    results.push({
      id: m.id,
      label: `${m.firstname} ${m.lastname}`,
      sublabel: m.email + (m.phone ? ` | ${m.phone}` : ""),
      category: "member",
      href: `/admin/members/${m.id}`,
    });
  }

  // Workers
  const workers = await prisma.worker.findMany({
    where: {
      OR: [
        { firstname: { contains: q, mode: "insensitive" } },
        { lastname: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, firstname: true, lastname: true, email: true, role: true },
    take: 3,
  });
  for (const w of workers) {
    results.push({
      id: w.id,
      label: `${w.firstname} ${w.lastname}`,
      sublabel: `${w.role} | ${w.email}`,
      category: "worker",
      href: `/admin/workers/${w.id}`,
    });
  }

  // Plans
  const plans = await prisma.ticketPlan.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    select: { id: true, name: true, price: true, expireDays: true },
    take: 3,
  });
  for (const p of plans) {
    results.push({
      id: p.id,
      label: p.name,
      sublabel: `${p.expireDays} days | ₹${Number(p.price)}`,
      category: "plan",
      href: "/admin/plans",
    });
  }

  // Classes
  const classes = await prisma.gymClass.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    select: { id: true, name: true, classType: true },
    take: 3,
  });
  for (const c of classes) {
    results.push({
      id: c.id,
      label: c.name,
      sublabel: c.classType,
      category: "class",
      href: "/admin/classes",
    });
  }

  // Enquiries
  const enquiries = await prisma.enquiry.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, phone: true, status: true },
    take: 3,
  });
  for (const e of enquiries) {
    results.push({
      id: e.id,
      label: e.name,
      sublabel: `${e.status} | ${e.phone}`,
      category: "enquiry",
      href: `/admin/enquiries/${e.id}`,
    });
  }

  return results;
}
