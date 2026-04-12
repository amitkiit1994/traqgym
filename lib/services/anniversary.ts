import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export async function getTodayAnniversaries(locationId?: number) {
  try {
    const now = todayIST();
    const todayMonth = now.getMonth() + 1;
    const todayDay = now.getDate();

    const where: Record<string, unknown> = {};
    if (locationId) where.locationId = locationId;

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        phone: true,
        createdAt: true,
      },
    });

    const thisYear = now.getFullYear();

    return users
      .filter((u) => {
        const joinMonth = u.createdAt.getMonth() + 1;
        const joinDay = u.createdAt.getDate();
        const joinYear = u.createdAt.getFullYear();
        // Must be a past year to count as anniversary
        return joinMonth === todayMonth && joinDay === todayDay && joinYear < thisYear;
      })
      .map((u) => ({
        id: u.id,
        name: `${u.firstname} ${u.lastname}`,
        phone: u.phone || "-",
        joinDate: u.createdAt.toISOString(),
        yearsCompleted: now.getFullYear() - u.createdAt.getFullYear(),
      }));
  } catch (err) {
    console.error("[Anniversary] getTodayAnniversaries error:", err);
    return [];
  }
}

export async function getUpcomingAnniversaries(days: number, locationId?: number) {
  try {
    const now = todayIST();
    const thisYear = now.getFullYear();
    const todayOnly = new Date(thisYear, now.getMonth(), now.getDate());

    const where: Record<string, unknown> = {};
    if (locationId) where.locationId = locationId;

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        phone: true,
        createdAt: true,
      },
    });

    const results: {
      id: number;
      name: string;
      phone: string;
      joinDate: string;
      daysUntil: number;
      yearsCompleted: number;
    }[] = [];

    for (const u of users) {
      const joinYear = u.createdAt.getFullYear();
      if (joinYear >= thisYear) continue; // no anniversary for same-year joins

      let nextAnniversary = new Date(thisYear, u.createdAt.getMonth(), u.createdAt.getDate());
      let yearsCompleted = thisYear - joinYear;
      if (nextAnniversary <= todayOnly) {
        nextAnniversary = new Date(thisYear + 1, u.createdAt.getMonth(), u.createdAt.getDate());
        yearsCompleted = thisYear + 1 - joinYear;
      }

      const diffMs = nextAnniversary.getTime() - todayOnly.getTime();
      const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (daysUntil > 0 && daysUntil <= days) {
        results.push({
          id: u.id,
          name: `${u.firstname} ${u.lastname}`,
          phone: u.phone || "-",
          joinDate: u.createdAt.toISOString(),
          daysUntil,
          yearsCompleted,
        });
      }
    }

    results.sort((a, b) => a.daysUntil - b.daysUntil);
    return results;
  } catch (err) {
    console.error("[Anniversary] getUpcomingAnniversaries error:", err);
    return [];
  }
}
