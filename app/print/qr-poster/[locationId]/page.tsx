import { redirect } from "next/navigation";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { requireWorker } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { signQrToken } from "@/lib/services/qr-token";
import { getSetting } from "@/lib/services/settings";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { locationId: string };

export default async function PosterPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  try {
    await requireWorker(["admin"]);
  } catch {
    redirect("/login");
  }

  const { locationId: locationIdRaw } = await params;
  const locationId = Number(locationIdRaw);
  if (!Number.isInteger(locationId) || locationId <= 0) {
    return <PosterError message="Invalid location id" />;
  }

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, code: true, isActive: true, address: true },
  });
  if (!location) return <PosterError message="Location not found" />;

  if (!process.env.QR_TOKEN_SECRET || !process.env.QR_TOKEN_SECRET.trim()) {
    return (
      <PosterError message="QR_TOKEN_SECRET environment variable is not set. Add it to the deployment environment, then redeploy and retry." />
    );
  }

  const [maxAgeDaysSetting, gymName, gymLogo, gymPhone] = await Promise.all([
    getSetting("qr_token_max_age_days", "365"),
    getSetting("gym_name", process.env.NEXT_PUBLIC_GYM_NAME ?? "TraqGym"),
    getSetting("gym_logo", ""),
    getSetting("gym_phone", ""),
  ]);
  const maxAgeDays = Math.max(1, parseInt(maxAgeDaysSetting, 10) || 365);
  const expiresAt = Date.now() + maxAgeDays * 24 * 60 * 60 * 1000;

  const token = signQrToken({ locationId: location.id, expiresAt });

  // Resolve public base URL
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const envBase = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  const baseUrl = envBase || (host ? `${proto}://${host}` : "");
  const checkinUrl = `${baseUrl}/checkin?token=${encodeURIComponent(token)}`;

  // Generate QR PNG as data URL
  const qrDataUrl = await QRCode.toDataURL(checkinUrl, {
    width: 720,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  const expiryText = new Date(expiresAt).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm; }
        body { background: #ffffff !important; color: #0a0a0a; }
        .qr-poster-toolbar { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 10; }
        .qr-poster-btn { background: #0a0a0a; color: #ffffff; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; font-family: inherit; }
        .qr-poster-btn.secondary { background: #ffffff; color: #0a0a0a; border: 1px solid #d4d4d4; }
        .qr-poster { max-width: 600px; margin: 0 auto; padding: 32px; text-align: center; color: #0a0a0a; }
        .qr-poster .gym-name { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
        .qr-poster .location { font-size: 14px; color: #525252; margin: 0 0 24px; text-transform: uppercase; letter-spacing: 0.08em; }
        .qr-poster .headline { font-size: 32px; font-weight: 800; margin: 0 0 8px; line-height: 1.1; }
        .qr-poster .headline-hi { font-size: 24px; font-weight: 600; margin: 0 0 24px; color: #404040; }
        .qr-poster .qr-box { display: inline-block; padding: 16px; background: #ffffff; border: 4px solid #0a0a0a; border-radius: 16px; margin: 8px 0 24px; }
        .qr-poster .qr-box img { display: block; width: 320px; height: 320px; }
        .qr-poster ol.steps { text-align: left; max-width: 420px; margin: 0 auto 24px; padding-left: 0; list-style: none; counter-reset: step; }
        .qr-poster ol.steps li { display: flex; align-items: start; gap: 12px; margin: 8px 0; font-size: 15px; }
        .qr-poster ol.steps li::before { content: counter(step); counter-increment: step; flex: 0 0 24px; height: 24px; background: #0a0a0a; color: #ffffff; border-radius: 50%; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
        .qr-poster .meta { font-size: 11px; color: #737373; border-top: 1px solid #e5e5e5; padding-top: 12px; margin-top: 16px; word-break: break-all; }
        .qr-poster .logo { max-height: 56px; margin-bottom: 12px; }
        @media print {
          .qr-poster-toolbar { display: none !important; }
          .qr-poster { padding: 0; }
        }
      `}</style>
      <div className="qr-poster-toolbar">
        <a className="qr-poster-btn secondary" href="/admin/settings/qr-checkin">Back</a>
        <PrintButton />
      </div>
      <div className="qr-poster">
        {gymLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="logo" src={gymLogo} alt={`${gymName} logo`} />
        ) : null}
        <p className="gym-name">{gymName}</p>
        <p className="location">
          {location.name}
          {location.address ? ` · ${location.address}` : ""}
        </p>

        <h1 className="headline">Scan to check in</h1>
        <p className="headline-hi">चेक-इन के लिए स्कैन करें</p>

        <div className="qr-box">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="Lobby check-in QR code" />
        </div>

        <ol className="steps">
          <li>Open your phone camera and point it at the QR code.</li>
          <li>Tap the link to open the check-in page.</li>
          <li>Sign in or enter your phone number to confirm.</li>
        </ol>

        <p className="meta">
          Location code {location.code} · Valid until {expiryText}
          {gymPhone ? ` · Help: ${gymPhone}` : ""}
        </p>
        <p className="meta">{checkinUrl}</p>
      </div>
    </>
  );
}

function PosterError({ message }: { message: string }) {
  return (
    <div style={{ fontFamily: "system-ui", padding: 32, maxWidth: 480, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20 }}>Cannot generate poster</h1>
      <p style={{ color: "#525252", fontSize: 14 }}>{message}</p>
      <p style={{ marginTop: 16 }}>
        <a href="/admin/settings/qr-checkin" style={{ color: "#0a0a0a" }}>
          ← Back to QR settings
        </a>
      </p>
    </div>
  );
}

