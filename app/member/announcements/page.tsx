import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone } from "lucide-react";

export default async function MemberAnnouncementsPage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const now = new Date();

  const announcements = await prisma.announcement.findMany({
    where: {
      isActive: true,
      targetGroup: { in: ["all", "members"] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <h1 className="text-2xl font-bold">Announcements</h1>

      {announcements.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center">
          <Megaphone className="size-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No announcements</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card
              key={a.id}
              className={
                a.priority === "urgent"
                  ? "border-status-expired/30 bg-status-expired-bg"
                  : a.priority === "high"
                  ? "border-status-expiring/30 bg-status-expiring-bg"
                  : "border-status-info/30 bg-status-info-bg"
              }
            >
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{a.content}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {a.priority !== "normal" && (
                      <Badge
                        variant={
                          a.priority === "urgent"
                            ? "destructive"
                            : "secondary"
                        }
                        className="capitalize"
                      >
                        {a.priority}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {a.createdAt.toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
