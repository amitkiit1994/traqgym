import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatsChart } from "./stats-chart";

export default async function MemberStatsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const userId = parseInt(session.user.id);
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const attendance = await prisma.attendanceLog.findMany({
    where: {
      userId,
      attendanceDate: { gte: thirtyDaysAgo },
    },
    select: { attendanceDate: true },
  });

  const attendanceDates = new Set(
    attendance.map((a) => a.attendanceDate.toISOString().split("T")[0])
  );

  const chartData: { date: string; present: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    chartData.push({
      date: key,
      present: attendanceDates.has(key) ? 1 : 0,
    });
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Attendance Stats</h1>
      <StatsChart data={chartData} />
    </div>
  );
}
