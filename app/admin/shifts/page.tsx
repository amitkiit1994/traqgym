import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  listOpenShifts,
  listClosedShifts,
  listPendingApprovalShifts,
} from "@/lib/services/cash-shift";
import { ShiftsClient } from "./shifts-client";

export const dynamic = "force-dynamic";

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const role = (session.user as { role?: string }).role ?? "staff";

  const sp = await searchParams;
  const tabParam = typeof sp.tab === "string" ? sp.tab : "open";
  const tab =
    tabParam === "closed" || tabParam === "pending_approval" ? tabParam : "open";

  const [openRows, pendingRows, closedRows, locations] = await Promise.all([
    listOpenShifts(),
    listPendingApprovalShifts(),
    listClosedShifts({ limit: 100 }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const serialize = (rows: typeof openRows) =>
    rows.map((r) => ({
      ...r,
      openedAt: r.openedAt.toISOString(),
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    }));

  return (
    <ShiftsClient
      activeTab={tab}
      openShifts={serialize(openRows)}
      pendingShifts={serialize(pendingRows)}
      closedShifts={serialize(closedRows)}
      locations={locations}
      isAdmin={role === "admin"}
    />
  );
}
