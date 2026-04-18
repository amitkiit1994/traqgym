/**
 * Magic-link confirmation page (server component).
 *
 * Flow: owner clicks email button → /m/a/[token] → we verify token, look up
 * insight + chosen action, render a single confirm screen with a POST form.
 * The confirm POST executes the action and renders the "done" page.
 *
 * Idempotency: dismissed insights show "already done" (200 OK).
 * Expiry: invalid/expired tokens show "expired" with a dashboard link.
 */

import { verifyMagicLink, type MagicPayload } from "@/lib/ai/manager";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PR 16 K.3 — best-effort decode the insight id from an expired token so the
 * "Link expired" page can deep-link to the matching dashboard row. The
 * signature MUST already have failed verification before we use this — no
 * trust is placed in the payload other than as a hint.
 */
function bestEffortInsightIdFromToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const pad = parts[0].length % 4 === 0 ? "" : "=".repeat(4 - (parts[0].length % 4));
    const norm = parts[0].replace(/-/g, "+").replace(/_/g, "/") + pad;
    const payload = JSON.parse(Buffer.from(norm, "base64").toString("utf8")) as Partial<MagicPayload>;
    return typeof payload.insightId === "number" ? payload.insightId : null;
  } catch {
    return null;
  }
}

type ActionDef = { label?: string; action?: string; args?: Record<string, unknown> };

function shellPage(args: {
  title: string;
  body: string;
  cta?: { label: string; href: string; primary?: boolean };
}) {
  const ctaHtml = args.cta
    ? `<a href="${args.cta.href}" style="display:inline-block;margin-top:18px;padding:12px 22px;background:${args.cta.primary ? "#16a34a" : "#374151"};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">${args.cta.label}</a>`
    : "";
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          background: "#020617",
          color: "#f1f5f9",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <main
          style={{
            maxWidth: 520,
            width: "92%",
            background: "#0f172a",
            borderRadius: 14,
            padding: "32px 28px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              margin: "0 0 14px 0",
              fontSize: 22,
              fontWeight: 700,
              color: "#f8fafc",
            }}
          >
            {args.title}
          </h1>
          <div
            style={{
              color: "#cbd5e1",
              fontSize: 15,
              lineHeight: 1.6,
            }}
            dangerouslySetInnerHTML={{ __html: args.body }}
          />
          {args.cta ? (
            <div dangerouslySetInnerHTML={{ __html: ctaHtml }} />
          ) : null}
        </main>
      </body>
    </html>
  );
}

export default async function MagicLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const verified = verifyMagicLink({ token });
  if (!verified.ok) {
    if (verified.error === "expired") {
      // PR 16 K.3 — surface the insight id (decoded best-effort from the
      // expired token's payload — signature already failed verification, so
      // we treat the id as a deep-link hint, never as auth) and route the
      // CTA to the insight list / specific row.
      const hintedId = bestEffortInsightIdFromToken(token);
      const dashboardHref = "/admin/dashboard";
      const insightHref = hintedId
        ? `/admin/dashboard?insight=${hintedId}`
        : dashboardHref;
      const idLine = hintedId
        ? `<p style="margin:8px 0 0 0;color:#94a3b8;font-size:13px;">Insight reference: <code style="background:#0b1224;padding:2px 6px;border-radius:4px;">#${hintedId}</code></p>`
        : "";
      return shellPage({
        title: "Link expired",
        body: `<p>This action link has expired for security. Open the dashboard to act on the latest insights.</p>${idLine}`,
        cta: { label: "Open dashboard to act", href: insightHref, primary: true },
      });
    }
    return shellPage({
      title: "Invalid link",
      body: "This link is malformed or has been tampered with.",
      cta: { label: "Open dashboard", href: "/admin/dashboard" },
    });
  }

  const insight = await prisma.insight.findUnique({
    where: { id: verified.insightId },
    select: {
      id: true,
      title: true,
      body: true,
      severity: true,
      suggestedActions: true,
      dismissedAt: true,
    },
  });

  if (!insight) {
    return shellPage({
      title: "Insight not found",
      body: "The insight referenced by this link no longer exists.",
      cta: { label: "Open dashboard", href: "/admin" },
    });
  }

  if (insight.dismissedAt) {
    return shellPage({
      title: "Already done",
      body: `<p>The action on <strong>${escapeHtml(insight.title)}</strong> has already been completed or dismissed.</p>`,
      cta: { label: "Open dashboard", href: "/admin", primary: true },
    });
  }

  const actions = (insight.suggestedActions as ActionDef[] | null) ?? [];
  const chosen = actions[verified.actionIndex];
  if (!chosen || typeof chosen.action !== "string") {
    return shellPage({
      title: "Action unavailable",
      body: "The action referenced by this link is no longer available on this insight.",
      cta: { label: "Open dashboard", href: "/admin" },
    });
  }

  const expiresLabel = new Date(verified.expiresAt).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
  });

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 0,
          background: "#020617",
          color: "#f1f5f9",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <main
          style={{
            maxWidth: 560,
            width: "92%",
            background: "#0f172a",
            borderRadius: 14,
            padding: "32px 28px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "3px 8px",
              background: "#1e3a8a",
              color: "#dbeafe",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {insight.severity}
          </div>
          <h1
            style={{
              margin: "4px 0 14px 0",
              fontSize: 22,
              fontWeight: 700,
              color: "#f8fafc",
            }}
          >
            {insight.title}
          </h1>
          <p
            style={{
              color: "#cbd5e1",
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              margin: "0 0 18px 0",
            }}
          >
            {insight.body}
          </p>

          <div
            style={{
              padding: "14px 16px",
              background: "#0b1224",
              borderRadius: 8,
              border: "1px solid #1e293b",
              margin: "0 0 18px 0",
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
              You are about to execute:
            </p>
            <p
              style={{
                margin: "6px 0 0 0",
                fontSize: 15,
                fontWeight: 600,
                color: "#f1f5f9",
              }}
            >
              {chosen.label || chosen.action}
            </p>
            {Object.keys(chosen.args || {}).length > 0 ? (
              <pre
                style={{
                  margin: "8px 0 0 0",
                  fontSize: 12,
                  color: "#94a3b8",
                  overflow: "auto",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {JSON.stringify(chosen.args, null, 2)}
              </pre>
            ) : null}
          </div>

          <form method="POST" action={`/m/a/${encodeURIComponent(token)}/confirm`}>
            <button
              type="submit"
              style={{
                display: "inline-block",
                padding: "12px 22px",
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
                width: "100%",
              }}
            >
              Confirm and execute
            </button>
          </form>

          <p
            style={{
              margin: "14px 0 0 0",
              color: "#64748b",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            Link expires {expiresLabel}.{" "}
            <a href="/admin" style={{ color: "#3b82f6" }}>
              Open dashboard
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
