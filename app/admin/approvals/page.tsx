import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  listPending,
  getPendingCount,
  type ApprovalType,
  type ApprovalStatus,
} from "@/lib/services/approvals";
import { ApprovalsClient } from "./approvals-client";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES: ApprovalType[] = [
  "comp",
  "comp_pass",
  "freeze",
  "extension",
  "refund",
  "discount_over_threshold",
];
const ALLOWED_STATUSES: ApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
];

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const role = (session.user as { role?: string }).role ?? "staff";
  if (role !== "admin") redirect("/admin/dashboard");

  const sp = await searchParams;
  const typeParam = typeof sp.type === "string" ? sp.type : "all";
  const statusParam = typeof sp.status === "string" ? sp.status : "pending";

  const safeType: ApprovalType | "all" =
    typeParam !== "all" && (ALLOWED_TYPES as string[]).includes(typeParam)
      ? (typeParam as ApprovalType)
      : "all";
  const safeStatus: ApprovalStatus = (ALLOWED_STATUSES as string[]).includes(
    statusParam
  )
    ? (statusParam as ApprovalStatus)
    : "pending";

  const [rows, pendingCount] = await Promise.all([
    listPending({
      type: safeType === "all" ? undefined : safeType,
      status: safeStatus,
    }),
    getPendingCount(),
  ]);

  // Serialize Date objects → ISO strings for client.
  const serializedRows = rows.map((r) => ({
    ...r,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <ApprovalsClient
      initialRows={serializedRows}
      pendingCount={pendingCount}
      activeType={safeType}
      activeStatus={safeStatus}
      isAdmin={role === "admin"}
    />
  );
}
