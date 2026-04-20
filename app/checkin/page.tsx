import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyQrToken } from "@/lib/services/qr-token";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { CheckinClient } from "./checkin-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = { token?: string; force?: string };

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const token = (sp.token ?? "").trim();
  const session = await getServerSession(authOptions);
  const isAdminWorker =
    (session?.user as { actorType?: string; role?: string } | undefined)?.actorType === "worker" &&
    (session?.user as { actorType?: string; role?: string } | undefined)?.role === "admin";
  const force = isAdminWorker && (sp.force === "true" || sp.force === "1");

  const enabledSetting = await getSetting("qr_checkin_enabled", "false");
  const enabled = enabledSetting === "true";

  if (!enabled) {
    return (
      <ErrorShell
        title="QR check-in is disabled"
        message="Ask the gym admin to enable QR self-check-in in Settings."
      />
    );
  }

  if (!token) {
    return (
      <ErrorShell
        title="Missing QR token"
        message="Scan the lobby QR poster to check in."
      />
    );
  }

  const verified = verifyQrToken(token, { ignoreExpiry: force });
  if (!verified.ok) {
    let message = "This QR code is not valid.";
    if (verified.reason === "expired") {
      message = "This QR code has expired. Ask the front desk to print a new one.";
    } else if (verified.reason === "missing_secret") {
      message = "Server is not configured for QR check-in. Contact the admin.";
    }
    return <ErrorShell title="Invalid QR" message={message} />;
  }

  const location = await prisma.location.findUnique({
    where: { id: verified.locationId },
    select: { id: true, name: true, isActive: true },
  });

  if (!location || !location.isActive) {
    return (
      <ErrorShell
        title="Location unavailable"
        message="This location is no longer accepting QR check-ins."
      />
    );
  }

  const memberSession =
    session && (session.user as { actorType?: string })?.actorType === "member"
      ? {
          id: Number((session.user as { id: string | number }).id),
          name: session.user.name ?? "",
        }
      : null;

  const gymName = await getSetting("gym_name", process.env.NEXT_PUBLIC_GYM_NAME ?? "TraqGym");

  return (
    <CheckinClient
      token={token}
      locationId={location.id}
      locationName={location.name}
      gymName={gymName}
      memberSession={memberSession}
    />
  );
}

function ErrorShell({ title, message }: { title: string; message: string }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-4 bg-background text-foreground">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
        <h1 className="text-2xl font-semibold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </main>
  );
}
