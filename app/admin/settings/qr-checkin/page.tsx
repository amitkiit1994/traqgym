import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorker } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function QrCheckinAdminPage() {
  try {
    await requireWorker(["admin"]);
  } catch {
    redirect("/login");
  }

  const [enabled, rateLimitHours, maxAgeDays, allowPhoneOnly, secretConfigured, locations] =
    await Promise.all([
      getSetting("qr_checkin_enabled", "false"),
      getSetting("qr_checkin_rate_limit_hours", "4"),
      getSetting("qr_token_max_age_days", "365"),
      getSetting("qr_checkin_allow_phone_only", "false"),
      Promise.resolve(Boolean(process.env.QR_TOKEN_SECRET && process.env.QR_TOKEN_SECRET.trim())),
      prisma.location.findMany({
        orderBy: { id: "asc" },
        select: { id: true, name: true, code: true, isActive: true },
      }),
    ]);

  const isEnabled = enabled === "true";

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl font-semibold">QR Self-Check-in</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Print a QR poster for each location. Members scan with their phone to mark
          attendance — no kiosk queue at the biometric machine.
        </p>
      </div>

      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Feature">
            <span
              className={isEnabled ? "text-status-active font-medium" : "text-muted-foreground"}
            >
              {isEnabled ? "Enabled" : "Disabled"}
            </span>
            {!isEnabled && (
              <span className="text-xs text-muted-foreground ml-2">
                — turn on in Settings &rarr; Operations
              </span>
            )}
          </Row>
          <Row label="QR_TOKEN_SECRET env">
            <span
              className={
                secretConfigured ? "text-status-active font-medium" : "text-destructive font-medium"
              }
            >
              {secretConfigured ? "Configured" : "Missing — posters will not work"}
            </span>
          </Row>
          <Row label="Rate limit">
            <span className="font-medium">1 check-in / {rateLimitHours} hours per member</span>
          </Row>
          <Row label="Token validity">
            <span className="font-medium">{maxAgeDays} days from generation</span>
          </Row>
          <Row label="Phone-only check-in">
            <span
              className={
                allowPhoneOnly === "true" ? "text-status-active font-medium" : "text-muted-foreground"
              }
            >
              {allowPhoneOnly === "true" ? "Allowed (no OTP yet)" : "Disabled — sign-in required"}
            </span>
          </Row>
        </CardContent>
      </Card>

      <Card className="max-w-2xl w-full">
        <CardHeader>
          <CardTitle>Lobby posters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {locations.length === 0 && (
            <p className="text-sm text-muted-foreground">No locations yet.</p>
          )}
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{loc.name}</p>
                <p className="text-xs text-muted-foreground">
                  Code {loc.code} · {loc.isActive ? "Active" : "Inactive"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/print/qr-poster/${loc.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    !loc.isActive && "pointer-events-none opacity-50",
                  )}
                  aria-disabled={!loc.isActive}
                >
                  Generate poster
                </Link>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-2">
            Posters open in a new tab. Use your browser&apos;s &quot;Print to PDF&quot; (Cmd/Ctrl+P)
            to save and print on A4. Reprint after rotating the secret.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
