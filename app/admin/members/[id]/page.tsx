import { getMember } from "@/lib/actions/members";
import { getLocations } from "@/lib/actions/locations";
import { getPlans } from "@/lib/actions/plans";
import { getMemberPayments } from "@/lib/actions/payment-history";
import { getMeasurements } from "@/lib/actions/measurements";
import { getReferralCount } from "@/lib/actions/referrals";
import { notFound } from "next/navigation";
import { MemberDetailClient } from "./member-detail-client";
import { prisma } from "@/lib/prisma";
import { detectAttendanceAnomaly } from "@/lib/services/attendance-anomaly";
import { calculateChurnRisk } from "@/lib/services/churn-risk";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const memberId = parseInt(id, 10);
  const member = await getMember(memberId);
  if (!member) notFound();

  const [locations, payments, measurements, freezes, extensions, allPlans, referralCount, anomaly, churnRisk] = await Promise.all([
    getLocations(),
    getMemberPayments(memberId).then((r) => r.payments),
    getMeasurements(memberId),
    prisma.membershipFreeze.findMany({
      where: { userId: memberId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.membershipExtension.findMany({
      where: { userId: memberId },
      orderBy: { createdAt: "desc" },
    }),
    getPlans(),
    getReferralCount(memberId),
    detectAttendanceAnomaly(memberId),
    calculateChurnRisk(memberId),
  ]);

  const activeLocations = locations
    .filter((l) => l.isActive)
    .map((l) => ({ id: l.id, name: l.name }));

  // Serialize dates to strings for client component
  const serialized = {
    id: member.id,
    firstname: member.firstname,
    lastname: member.lastname,
    email: member.email,
    phone: member.phone,
    gender: member.gender,
    isActive: member.isActive,
    createdAt: member.createdAt.toISOString(),
    location: member.location ? { id: member.location.id, name: member.location.name } : null,
    memberTickets: member.memberTickets.map((t) => ({
      id: t.id,
      buyDate: t.buyDate.toISOString(),
      expireDate: t.expireDate.toISOString(),
      plan: { id: t.plan.id, name: t.plan.name, price: Number(t.plan.price), expireDays: t.plan.expireDays },
      status: t.status,
    })),
    attendanceLogs: member.attendanceLogs.map((l) => ({
      id: l.id,
      attendanceDate: l.attendanceDate.toISOString(),
      checkIn: l.checkIn.toISOString(),
      checkOut: l.checkOut ? l.checkOut.toISOString() : null,
      source: l.source,
      location: { name: l.location.name },
    })),
    freezes: freezes.map((f) => ({
      id: f.id,
      freezeStart: f.freezeStart.toISOString(),
      freezeEnd: f.freezeEnd.toISOString(),
      reason: f.reason,
      status: f.status,
      daysAdded: f.daysAdded,
    })),
    extensions: extensions.map((e) => ({
      id: e.id,
      daysAdded: e.daysAdded,
      reason: e.reason,
      originalExpiry: e.originalExpiry.toISOString(),
      newExpiry: e.newExpiry.toISOString(),
      createdAt: e.createdAt.toISOString(),
    })),
    payments,
    measurements,
  };

  const activePlans = allPlans
    .filter((p) => p.isActive)
    .map((p) => ({ id: p.id, name: p.name, expireDays: p.expireDays, price: p.price }));

  return (
    <div className="space-y-4">
      <MemberDetailClient member={serialized} locations={activeLocations} plans={activePlans} anomaly={anomaly} churnRisk={churnRisk} />
      {referralCount > 0 && (
        <div className="max-w-4xl rounded-lg border p-4">
          <h3 className="text-sm font-medium mb-1">Referrals</h3>
          <p className="text-sm text-muted-foreground">
            This member has referred {referralCount} {referralCount === 1 ? "person" : "people"}.
          </p>
        </div>
      )}
    </div>
  );
}
