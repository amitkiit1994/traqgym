import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Gift } from "lucide-react";

export default async function MemberReferralsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const userId = parseInt(session.user.id);

  const [referrals, totalCount] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referred: { select: { firstname: true, lastname: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.referral.count({ where: { referrerId: userId } }),
  ]);

  const rewardedCount = referrals.filter((r) => r.rewardGiven).length;

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <h1 className="text-2xl font-bold">My Referrals</h1>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4 px-4">
            <Gift className="size-5 text-green-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{totalCount}</p>
              <p className="text-xs text-muted-foreground">Total Referrals</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4 px-4">
            <Gift className="size-5 text-yellow-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{rewardedCount}</p>
              <p className="text-xs text-muted-foreground">Rewards Earned</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Referral History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referred Person</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reward</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {referrals.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {r.referred
                      ? `${r.referred.firstname} ${r.referred.lastname}`
                      : r.referredName}
                  </TableCell>
                  <TableCell>{r.referredPhone}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "converted"
                          ? "default"
                          : r.status === "pending"
                          ? "secondary"
                          : "outline"
                      }
                      className="capitalize"
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.rewardGiven ? (
                      <Badge variant="default">Earned</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.createdAt.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                </TableRow>
              ))}
              {referrals.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No referrals yet. Refer a friend to earn rewards!
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
