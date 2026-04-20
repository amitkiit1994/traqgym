/**
 * Manager email renderer — converts a ComposedBriefing into mobile-friendly,
 * dark-mode-aware HTML.
 *
 * Constraints:
 *   - Inline CSS only (Gmail/Outlook strip <style> blocks).
 *   - Table-based layout for client compatibility.
 *   - 600px max width, mobile-friendly padding.
 *   - dark/light handled via @media (prefers-color-scheme: dark) which IS
 *     supported in <head><style> by modern clients (Apple Mail, iOS Mail,
 *     Gmail dark theme respects color-scheme meta). We include both because
 *     stripping the <style> still leaves usable inline styles.
 */

import type { ComposedBriefing, ComposedSection } from "./manager";

export type RenderedEmail = {
  subject: string;
  html: string;
  plain: string;
};

const SEVERITY_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: "#7f1d1d", fg: "#fee2e2", label: "CRITICAL" },
  high: { bg: "#9a3412", fg: "#ffedd5", label: "HIGH" },
  medium: { bg: "#854d0e", fg: "#fef9c3", label: "MEDIUM" },
  low: { bg: "#1e3a8a", fg: "#dbeafe", label: "LOW" },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRupees(n: number): string {
  if (n <= 0) return "";
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${Math.round(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}

function renderSection(section: ComposedSection, baseUrl: string): string {
  const badge = SEVERITY_BADGE[section.severity] ?? SEVERITY_BADGE.low;
  const impact = formatRupees(section.impactRupees);

  // Snooze 7d link: same insight, special action index = -1 sentinel via a
  // dedicated /m/snooze path is overkill for v1. We just provide the dashboard
  // fallback ("Open dashboard") for non-action operations.
  const dashboardUrl = `${baseUrl.replace(/\/+$/, "")}/admin/insights`;

  // Action chips (max 3 visible — anything more goes to dashboard)
  const visibleActions = section.actions.slice(0, 2);
  const actionChips = visibleActions
    .map((a, idx) => {
      const isPrimary = idx === 0;
      const bg = isPrimary ? "#16a34a" : "#374151";
      const fg = "#ffffff";
      // Pure navigation actions don't need the magic-link wrapper — they're
      // just deep links into the dashboard. Render as a plain same-origin
      // anchor so the click works even if the magic-link dispatcher has been
      // changed and so the URL isn't a single-use token. The href in
      // `args.href` is whitelisted to same-origin paths.
      let href = a.magicUrl;
      if (a.action === "navigate") {
        const navHref =
          typeof a.args?.href === "string" ? a.args.href : "/admin/dashboard";
        const safeNavHref =
          navHref.startsWith("/") && !navHref.startsWith("//")
            ? navHref
            : "/admin/dashboard";
        href = `${baseUrl.replace(/\/+$/, "")}${safeNavHref}`;
      }
      return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 16px;margin:4px 6px 4px 0;background:${bg};color:${fg};text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;mso-padding-alt:0;">${escapeHtml(a.label)}</a>`;
    })
    .join("");

  const dashboardChip = `<a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:10px 16px;margin:4px 6px 4px 0;background:transparent;color:#3b82f6;text-decoration:none;border:1px solid #3b82f6;border-radius:6px;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Open dashboard</a>`;

  const impactSpan = impact
    ? `<span style="display:inline-block;margin-left:8px;color:#94a3b8;font-size:13px;font-weight:500;">~${escapeHtml(impact)} impact</span>`
    : "";

  // Convert plain-text body to HTML paragraphs (split on blank line).
  const bodyHtml = section.body
    .split(/\n\s*\n/)
    .map(
      (para) =>
        `<p style="margin:0 0 10px 0;color:#cbd5e1;font-size:14px;line-height:1.55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${escapeHtml(para).replace(/\n/g, "<br />")}</p>`
    )
    .join("");

  return `
  <tr>
    <td style="padding:20px 24px;border-top:1px solid #1e293b;background:#0f172a;">
      <div style="margin:0 0 8px 0;">
        <span style="display:inline-block;padding:3px 8px;background:${badge.bg};color:${badge.fg};border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${badge.label}</span>
        ${impactSpan}
      </div>
      <h2 style="margin:0 0 12px 0;color:#f1f5f9;font-size:17px;font-weight:600;line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${escapeHtml(section.title)}</h2>
      ${bodyHtml}
      <div style="margin-top:14px;">
        ${actionChips}${dashboardChip}
      </div>
    </td>
  </tr>`;
}

function renderPlain(briefing: ComposedBriefing): string {
  const lines: string[] = [];
  lines.push(briefing.intro);
  lines.push("");
  for (const s of briefing.sections) {
    lines.push(`[${s.severity.toUpperCase()}] ${s.title}`);
    if (s.impactRupees > 0) lines.push(`Impact: ~${formatRupees(s.impactRupees)}`);
    lines.push("");
    lines.push(s.body);
    lines.push("");
    for (const a of s.actions.slice(0, 2)) {
      lines.push(`  → ${a.label}: ${a.magicUrl}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

export function renderEmail(args: {
  briefing: ComposedBriefing;
  ownerName: string;
  gymName: string;
  baseUrl: string;
  /** Default: today's date in IST. */
  dateLabel?: string;
}): RenderedEmail {
  const date =
    args.dateLabel ??
    new Date().toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Asia/Kolkata",
    });

  const sectionsHtml = args.briefing.sections
    .map((s) => renderSection(s, args.baseUrl))
    .join("");

  const introHtml = escapeHtml(args.briefing.intro)
    .split("\n")
    .map((l) => `<p style="margin:0 0 12px 0;color:#cbd5e1;font-size:15px;line-height:1.55;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${l}</p>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark light" />
<meta name="supported-color-schemes" content="dark light" />
<title>${escapeHtml(args.briefing.subject)}</title>
<style>
  @media (prefers-color-scheme: light) {
    .body-bg { background:#f1f5f9 !important; }
    .card { background:#ffffff !important; }
    .header { background:#1e293b !important; }
    .section { background:#ffffff !important; border-top-color:#e2e8f0 !important; }
    .text-primary { color:#0f172a !important; }
    .text-secondary { color:#475569 !important; }
  }
</style>
</head>
<body class="body-bg" style="margin:0;padding:0;background:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#020617;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="card" style="max-width:600px;width:100%;background:#0f172a;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.4);">
        <tr>
          <td class="header" style="padding:24px 24px 18px 24px;background:#1e293b;">
            <div style="color:#94a3b8;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${escapeHtml(date)}</div>
            <h1 class="text-primary" style="margin:6px 0 0 0;color:#f8fafc;font-size:22px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Morning briefing — ${escapeHtml(args.gymName)}</h1>
          </td>
        </tr>
        <tr>
          <td class="section" style="padding:20px 24px;background:#0f172a;">
            ${introHtml}
          </td>
        </tr>
        ${sectionsHtml}
        <tr>
          <td style="padding:18px 24px;background:#0b1224;text-align:center;border-top:1px solid #1e293b;">
            <p class="text-secondary" style="margin:0;color:#64748b;font-size:12px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
              Action buttons in this email expire in 24 hours.<br />
              Open <a href="${escapeHtml(args.baseUrl.replace(/\/+$/, ""))}/admin/insights" style="color:#3b82f6;text-decoration:none;">${escapeHtml(args.gymName)} dashboard</a> for the full list.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return {
    subject: args.briefing.subject,
    html,
    plain: renderPlain(args.briefing),
  };
}
