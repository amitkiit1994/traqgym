import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorker } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function TrainersIndexPage() {
  try {
    await requireWorker(["admin"]);
  } catch {
    redirect("/admin/dashboard");
  }

  const trainers = await prisma.worker.findMany({
    where: {
      OR: [
        { ptPackagesAsTrainer: { some: {} } },
        { trainerPayments: { some: {} } },
      ],
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      email: true,
      role: true,
      isActive: true,
      isExternal: true,
      _count: {
        select: {
          ptPackagesAsTrainer: { where: { status: "active" } },
          trainerPayments: true,
        },
      },
    },
    orderBy: [{ isActive: "desc" }, { firstname: "asc" }],
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Trainers</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Workers with PT packages or PT-tagged payments. Click a row for client list, sessions, and payouts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{trainers.length} trainer{trainers.length === 1 ? "" : "s"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Email</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-right px-4 py-2">Active packages</th>
                  <th className="text-right px-4 py-2">PT payments</th>
                  <th className="text-left px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {trainers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No trainers found yet. Trainers appear here once they have a PT package or a PT-tagged payment.
                    </td>
                  </tr>
                ) : (
                  trainers.map((t) => (
                    <tr key={t.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/trainers/${t.id}`}
                          className="font-medium hover:underline"
                        >
                          {t.firstname} {t.lastname}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{t.email}</td>
                      <td className="px-4 py-3">
                        {t.isExternal ? (
                          <Badge variant="outline">Freelancer</Badge>
                        ) : (
                          <Badge variant="secondary">In-house</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {t._count.ptPackagesAsTrainer}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {t._count.trainerPayments}
                      </td>
                      <td className="px-4 py-3">
                        {t.isActive ? (
                          <Badge variant="default">Active</Badge>
                        ) : (
                          <Badge variant="destructive">Inactive</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
