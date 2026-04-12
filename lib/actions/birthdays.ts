"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";

export async function getTodaysBirthdays() {
  try { await requireWorker(); } catch { return []; }
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const users = await prisma.user.findMany({
    where: {
      birthdate: { not: null },
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      phone: true,
      birthdate: true,
    },
  });

  return users
    .filter((u) => {
      if (!u.birthdate) return false;
      const bd = new Date(u.birthdate);
      return bd.getMonth() + 1 === month && bd.getDate() === day;
    })
    .map((u) => ({
      id: u.id,
      name: `${u.firstname} ${u.lastname}`,
      phone: u.phone || "-",
      birthdate: u.birthdate!.toISOString(),
    }));
}

export async function getUpcomingBirthdays(days: number) {
  try { await requireWorker(); } catch { return []; }
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const users = await prisma.user.findMany({
    where: {
      birthdate: { not: null },
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      phone: true,
      birthdate: true,
    },
  });

  const results: {
    id: number;
    name: string;
    phone: string;
    birthdate: string;
    daysUntil: number;
  }[] = [];

  const thisYear = now.getFullYear();

  for (const u of users) {
    if (!u.birthdate) continue;
    const bd = new Date(u.birthdate);

    // Birthday this year
    let nextBirthday = new Date(thisYear, bd.getMonth(), bd.getDate());
    if (nextBirthday < now) {
      nextBirthday = new Date(thisYear + 1, bd.getMonth(), bd.getDate());
    }

    const diffMs = nextBirthday.getTime() - now.getTime();
    const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysUntil > 0 && daysUntil <= days) {
      results.push({
        id: u.id,
        name: `${u.firstname} ${u.lastname}`,
        phone: u.phone || "-",
        birthdate: u.birthdate.toISOString(),
        daysUntil,
      });
    }
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}
