/**
 * Manager core — composes morning briefings from active insights and signs
 * magic-link action URLs.
 *
 * Pure functions only — no Prisma, no channel I/O. The cron route calls
 * `composeBriefing()` + `renderEmail()` (manager-email.ts) + `email.send()`.
 *
 * LLM usage: when `OPENAI_API_KEY` is set the briefing intro and per-section
 * paragraphs are humanised via OpenAI. When unset (or on any error) we fall
 * back to a deterministic template — zero LLM cost. The toggle is implicit:
 * presence of the env var.
 *
 * Magic-link tokens: `base64url(payloadJSON) + "." + base64url(hmacSha256)`.
 * Verified with `crypto.timingSafeEqual` to defeat timing attacks. The signing
 * secret comes from `MANAGER_ACTION_SECRET`, falling back to `NEXTAUTH_SECRET`
 * with a warning so a fresh install still produces working links.
 */

import crypto from "node:crypto";
import type { Insight } from "@prisma/client";

// ─── Types ─────────────────────────────────────────────────────────────────

export type Lang = "en" | "hi" | "hinglish";

export type ComposedActionLink = {
  label: string;
  action: string;
  args: Record<string, unknown>;
  /** Pre-built magic URL for this action (HMAC-signed, expires in 24h by default). */
  magicUrl: string;
};

export type ComposedSection = {
  insightId: number;
  severity: string;
  title: string;
  body: string;
  /** Estimated impact in rupees (from dataJson.estimatedImpactRupees), 0 if unknown. */
  impactRupees: number;
  actions: ComposedActionLink[];
};

export type ComposedBriefing = {
  subject: string;
  intro: string;
  sections: ComposedSection[];
  /** Counts grouped by severity for the subject line. */
  counts: { critical: number; high: number; medium: number; low: number };
  totalImpactRupees: number;
};

// ─── Severity ranking (shared with insight service) ────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function getImpact(insight: Insight): number {
  const data = insight.dataJson as Record<string, unknown> | null;
  if (!data) return 0;
  const v = data.estimatedImpactRupees;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function getActions(insight: Insight): Array<{
  label: string;
  action: string;
  args: Record<string, unknown>;
}> {
  const raw = insight.suggestedActions as unknown;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ label: string; action: string; args: Record<string, unknown> }> = [];
  for (const entry of raw) {
    if (entry == null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.label !== "string" || typeof e.action !== "string") continue;
    const args =
      e.args != null && typeof e.args === "object" && !Array.isArray(e.args)
        ? (e.args as Record<string, unknown>)
        : {};
    out.push({ label: e.label, action: e.action, args });
  }
  return out;
}

function formatRupees(n: number): string {
  if (n <= 0) return "₹0";
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${Math.round(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}

// ─── rankInsights (pure, exported for tests) ───────────────────────────────

export function rankInsights<T extends Insight>(insights: T[], topN = 5): T[] {
  const sorted = [...insights].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity] ?? 99;
    const sb = SEVERITY_RANK[b.severity] ?? 99;
    if (sa !== sb) return sa - sb;
    const ia = getImpact(a);
    const ib = getImpact(b);
    if (ia !== ib) return ib - ia; // higher impact first
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return sorted.slice(0, Math.max(0, topN));
}

// ─── Magic-link signing ────────────────────────────────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(norm, "base64");
}

let warnedFallbackSecret = false;
function resolveSecret(explicitSecret?: string): string {
  if (explicitSecret && explicitSecret.length > 0) return explicitSecret;
  const env = process.env.MANAGER_ACTION_SECRET;
  if (env && env.length > 0) return env;
  const fallback = process.env.NEXTAUTH_SECRET;
  if (fallback && fallback.length > 0) {
    if (!warnedFallbackSecret) {
      warnedFallbackSecret = true;
      console.warn(
        "[manager] MANAGER_ACTION_SECRET not set — using NEXTAUTH_SECRET-derived fallback. Set MANAGER_ACTION_SECRET in production."
      );
    }
    // Derive a distinct key so leaking one doesn't leak the other.
    return crypto
      .createHmac("sha256", fallback)
      .update("manager-action-secret-v1")
      .digest("hex");
  }
  throw new Error(
    "Cannot sign magic links: neither MANAGER_ACTION_SECRET nor NEXTAUTH_SECRET is set."
  );
}

export type MagicPayload = {
  insightId: number;
  actionIndex: number;
  expiresAt: number; // epoch ms
};

export function signMagicLink(params: {
  insightId: number;
  actionIndex: number;
  expiresAt: Date;
  baseUrl: string;
  secret?: string;
}): string {
  const secret = resolveSecret(params.secret);
  const payload: MagicPayload = {
    insightId: params.insightId,
    actionIndex: params.actionIndex,
    expiresAt: params.expiresAt.getTime(),
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = crypto.createHmac("sha256", secret).update(payloadB64).digest();
  const macB64 = base64UrlEncode(mac);
  const token = `${payloadB64}.${macB64}`;
  const base = params.baseUrl.replace(/\/+$/, "");
  return `${base}/m/a/${token}`;
}

export type VerifyResult =
  | { ok: true; insightId: number; actionIndex: number; expiresAt: number }
  | { ok: false; error: "malformed" | "bad_signature" | "expired" | "invalid" };

export function verifyMagicLink(params: {
  token: string;
  secret?: string;
  now?: Date;
}): VerifyResult {
  const parts = params.token.split(".");
  if (parts.length !== 2) return { ok: false, error: "malformed" };
  const [payloadB64, macB64] = parts;

  let secret: string;
  try {
    secret = resolveSecret(params.secret);
  } catch {
    return { ok: false, error: "invalid" };
  }

  const expectedMac = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest();
  let providedMac: Buffer;
  try {
    providedMac = base64UrlDecode(macB64);
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (providedMac.length !== expectedMac.length) {
    return { ok: false, error: "bad_signature" };
  }
  if (!crypto.timingSafeEqual(providedMac, expectedMac)) {
    return { ok: false, error: "bad_signature" };
  }

  let payload: MagicPayload;
  try {
    const json = base64UrlDecode(payloadB64).toString("utf8");
    payload = JSON.parse(json) as MagicPayload;
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (
    typeof payload.insightId !== "number" ||
    typeof payload.actionIndex !== "number" ||
    typeof payload.expiresAt !== "number"
  ) {
    return { ok: false, error: "malformed" };
  }
  const now = (params.now ?? new Date()).getTime();
  if (payload.expiresAt < now) {
    return { ok: false, error: "expired" };
  }
  return {
    ok: true,
    insightId: payload.insightId,
    actionIndex: payload.actionIndex,
    expiresAt: payload.expiresAt,
  };
}

// ─── LLM humaniser (optional) ──────────────────────────────────────────────

type LLMOutput = { intro: string; bodies: string[] };

async function humanizeWithLLM(args: {
  ownerName: string;
  gymName: string;
  lang: Lang;
  insights: Insight[];
}): Promise<LLMOutput | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const langName =
    args.lang === "hi" ? "Hindi" : args.lang === "hinglish" ? "Hinglish (mix of Hindi + English)" : "English";
  const personaPrompt = `You are ${args.ownerName}'s gym manager at ${args.gymName}. Write a 6 to 10 line summary in ${langName}. Each insight gets a heading + short paragraph. Be concise, actionable, no fluff.`;

  const insightLines = args.insights
    .map((ins, i) => {
      const impact = getImpact(ins);
      return `Insight ${i + 1} [severity=${ins.severity}, impact=${impact}]: ${ins.title}\n${ins.body}`;
    })
    .join("\n\n");

  const userPrompt = `Generate JSON with this exact shape (no prose outside JSON):\n{"intro": "<one short paragraph>", "bodies": ["<paragraph for insight 1>", "<paragraph for insight 2>", ...]}\n\nThere are ${args.insights.length} insights below; produce exactly that many entries in "bodies" in the same order.\n\n${insightLines}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: personaPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1200,
      }),
    });
    if (!res.ok) {
      console.warn("[manager] LLM humanise failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as LLMOutput;
    if (typeof parsed.intro !== "string" || !Array.isArray(parsed.bodies)) {
      return null;
    }
    if (parsed.bodies.length !== args.insights.length) {
      // Pad or truncate
      const bodies = [...parsed.bodies];
      while (bodies.length < args.insights.length) bodies.push("");
      bodies.length = args.insights.length;
      return { intro: parsed.intro, bodies };
    }
    return parsed;
  } catch (err) {
    console.warn("[manager] LLM humanise error:", err);
    return null;
  }
}

// ─── Template fallback (zero LLM cost) ─────────────────────────────────────

function templateIntro(args: {
  ownerName: string;
  gymName: string;
  lang: Lang;
  counts: { critical: number; high: number; medium: number; low: number };
  totalImpact: number;
}): string {
  const total =
    args.counts.critical +
    args.counts.high +
    args.counts.medium +
    args.counts.low;
  const impactStr = formatRupees(args.totalImpact);
  if (args.lang === "hi") {
    return `नमस्ते ${args.ownerName}, आज ${args.gymName} में ${total} ध्यान देने योग्य insights हैं (${args.counts.critical} critical, ${args.counts.high} high). कुल अनुमानित प्रभाव: ${impactStr}.`;
  }
  if (args.lang === "hinglish") {
    return `Hi ${args.ownerName}, aaj ${args.gymName} mein ${total} action items hain (${args.counts.critical} critical, ${args.counts.high} high). Total estimated impact: ${impactStr}.`;
  }
  return `Hi ${args.ownerName}, here is your morning briefing for ${args.gymName}: ${total} active insights (${args.counts.critical} critical, ${args.counts.high} high) with an estimated total impact of ${impactStr}.`;
}

function templateBody(insight: Insight): string {
  // Use the insight's own body verbatim — agents already wrote it for humans.
  return insight.body.trim();
}

// ─── composeBriefing ───────────────────────────────────────────────────────

export async function composeBriefing(args: {
  insights: Insight[];
  lang: Lang;
  ownerName: string;
  gymName: string;
  /** Top N to include. Default 5. */
  topN?: number;
  /** Base URL for magic-link buttons (e.g. https://gym.example.com). */
  baseUrl: string;
  /** TTL for magic-link buttons. Default 24h. */
  linkTtlHours?: number;
  /** Override the signing secret (mainly for tests). */
  secret?: string;
}): Promise<ComposedBriefing> {
  const topN = args.topN ?? 5;
  const ranked = rankInsights(args.insights, topN);

  // Counts cover ALL insights (not just topN) so subject reflects reality.
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  let totalImpact = 0;
  for (const ins of args.insights) {
    if (ins.severity === "critical") counts.critical++;
    else if (ins.severity === "high") counts.high++;
    else if (ins.severity === "medium") counts.medium++;
    else if (ins.severity === "low") counts.low++;
    totalImpact += getImpact(ins);
  }

  // Try LLM humanisation; fall back to templates on any failure or when key absent.
  const llm = await humanizeWithLLM({
    ownerName: args.ownerName,
    gymName: args.gymName,
    lang: args.lang,
    insights: ranked,
  });

  const intro =
    llm?.intro ??
    templateIntro({
      ownerName: args.ownerName,
      gymName: args.gymName,
      lang: args.lang,
      counts,
      totalImpact,
    });

  const ttlMs = (args.linkTtlHours ?? 24) * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  const sections: ComposedSection[] = ranked.map((ins, idx) => {
    const actionDefs = getActions(ins);
    const actions: ComposedActionLink[] = actionDefs.map((a, i) => ({
      label: a.label,
      action: a.action,
      args: a.args,
      magicUrl: signMagicLink({
        insightId: ins.id,
        actionIndex: i,
        expiresAt,
        baseUrl: args.baseUrl,
        secret: args.secret,
      }),
    }));
    return {
      insightId: ins.id,
      severity: ins.severity,
      title: ins.title,
      body: llm?.bodies[idx]?.trim() || templateBody(ins),
      impactRupees: getImpact(ins),
      actions,
    };
  });

  // Subject: "[Gym] Morning briefing — 3 critical, 2 high (₹52k impact)"
  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.high > 0) parts.push(`${counts.high} high`);
  if (parts.length === 0 && counts.medium > 0) parts.push(`${counts.medium} medium`);
  const summary = parts.length > 0 ? parts.join(", ") : "no critical items";
  const subject =
    totalImpact > 0
      ? `[${args.gymName}] Morning briefing — ${summary} (${formatRupees(totalImpact)} impact)`
      : `[${args.gymName}] Morning briefing — ${summary}`;

  return {
    subject,
    intro,
    sections,
    counts,
    totalImpactRupees: totalImpact,
  };
}
