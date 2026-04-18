import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  listRefunds,
  type RefundStatus,
} from "@/lib/services/refund";
import { RefundsClient } from "./refunds-client";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES: RefundStatus[] = [
  "pending",
  "approved",
  "processed",
  "rejected",
  "failed",
];

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const role = (session.user as { role?: string }).role ?? "staff";

  const sp = await searchParams;
  const statusParam = typeof sp.status === "string" ? sp.status : "pending";
  const status: RefundStatus | "all" =
    statusParam === "all"
      ? "all"
      : (ALLOWED_STATUSES as string[]).includes(statusParam)
        ? (statusParam as RefundStatus)
        : "pending";

  const rows = await listRefunds({
    status: status === "all" ? undefined : status,
  });

  // Serialize Date → ISO strings for client.
  const serialized = rows.map((r) => ({
    ...r,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <RefundsClient
      initialRows={serialized}
      activeStatus={status}
      isAdmin={role === "admin"}
    />
  );
}
