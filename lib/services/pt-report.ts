import { prisma } from "@/lib/prisma";

export async function getPTReport(startDate: string, endDate: string, locationId?: number) {
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1); // include the end date

    const where: Record<string, unknown> = {
      classType: { contains: "personal", mode: "insensitive" },
    };
    if (locationId) where.locationId = locationId;

    // Get PT classes with bookings in the date range
    const ptClasses = await prisma.gymClass.findMany({
      where,
      include: {
        instructor: {
          select: { id: true, firstname: true, lastname: true },
        },
        bookings: {
          where: {
            scheduleDate: { gte: start, lt: end },
          },
          select: {
            id: true,
            status: true,
            scheduleDate: true,
          },
        },
      },
    });

    // Group by instructor
    const instructorMap = new Map<
      number,
      {
        name: string;
        totalSessions: number;
        attended: number;
        noShow: number;
        cancelled: number;
        booked: number;
      }
    >();

    let totalBookings = 0;
    let totalAttended = 0;
    let totalNoShow = 0;
    let totalCancelled = 0;

    for (const cls of ptClasses) {
      const instructorId = cls.instructorId ?? 0;
      const instructorName = cls.instructor
        ? `${cls.instructor.firstname} ${cls.instructor.lastname}`
        : "Unassigned";

      if (!instructorMap.has(instructorId)) {
        instructorMap.set(instructorId, {
          name: instructorName,
          totalSessions: 0,
          attended: 0,
          noShow: 0,
          cancelled: 0,
          booked: 0,
        });
      }

      const stats = instructorMap.get(instructorId)!;

      for (const booking of cls.bookings) {
        totalBookings++;
        stats.totalSessions++;

        switch (booking.status) {
          case "attended":
            stats.attended++;
            totalAttended++;
            break;
          case "no_show":
            stats.noShow++;
            totalNoShow++;
            break;
          case "cancelled":
            stats.cancelled++;
            totalCancelled++;
            break;
          default:
            stats.booked++;
            break;
        }
      }
    }

    const byInstructor = Array.from(instructorMap.entries()).map(
      ([id, stats]) => ({
        instructorId: id || null,
        instructorName: stats.name,
        totalSessions: stats.totalSessions,
        attended: stats.attended,
        noShow: stats.noShow,
        cancelled: stats.cancelled,
        booked: stats.booked,
        completionRate:
          stats.totalSessions > 0
            ? Math.round((stats.attended / stats.totalSessions) * 100)
            : 0,
      })
    );

    return {
      period: { startDate, endDate },
      totalBookings,
      totalAttended,
      totalNoShow,
      totalCancelled,
      overallCompletionRate:
        totalBookings > 0
          ? Math.round((totalAttended / totalBookings) * 100)
          : 0,
      byInstructor,
    };
  } catch (err) {
    console.error("[PTReport] getPTReport error:", err);
    return {
      period: { startDate, endDate },
      totalBookings: 0,
      totalAttended: 0,
      totalNoShow: 0,
      totalCancelled: 0,
      overallCompletionRate: 0,
      byInstructor: [],
    };
  }
}
