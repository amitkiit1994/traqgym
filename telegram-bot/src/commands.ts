import type { BlobStoreRegistry } from "./data/blob-store.js";
import type { AllowlistStore, AllowlistEntry } from "./data/allowlist-store.js";
import { listGyms } from "./gyms.js";

export interface SlashContext {
  text: string;
  chatId: number;
  firstName: string;
  registry: BlobStoreRegistry;
  dispatchRefresh?: () => Promise<void>;
  // For approval flow:
  allowlistStore?: AllowlistStore;
  isOwner?: boolean;
}

const HELP = [
  "Try asking:",
  "  • How much did we collect 1-7 April?",
  "  • PT revenue vs gym revenue last week",
  "  • Who paid in cash on 4 April?",
  "  • Total members joined this month",
  "  • Is <member name> active?",
  "",
  "Commands: /start /help /snapshot /refresh /ping /reset",
  "Owner-only: /approve <chat_id> [name] /revoke <chat_id> /allowlist",
].join("\n");

export async function handleSlashCommand(ctx: SlashContext): Promise<string | null> {
  const cmd = ctx.text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  switch (cmd) {
    case "/start":
      return `Hi ${ctx.firstName}, you're authorized (chat id ${ctx.chatId}).\nAsk me anything about the gym.\n\n${HELP}`;
    case "/help":
      return HELP;
    case "/ping":
      return "pong";
    case "/snapshot": {
      // Per-gym snapshot. Missing gyms (e.g. EGYM before first scrape) get
      // a "no snapshot yet" line instead of blowing up the whole reply.
      const sections: string[] = [];
      for (const gym of listGyms()) {
        try {
          const p = await ctx.registry.for(gym.slug).fetchLatest();
          sections.push(
            `${gym.name}`,
            `  Last refresh: ${p.snapshot_ist}`,
            `  Snapshot date: ${p.snapshot_date}`,
            `  Rows: ${Object.entries(p.row_counts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
          );
        } catch (e) {
          const message = (e as Error).message;
          // Distinguish "gym not yet seeded" (404 — benign) from a real
          // outage (401/5xx/network — operator action needed). The latter
          // must NOT be labeled "no snapshot yet" or the operator trains
          // themselves to ignore it.
          const looksMissing = /404|not\s*found|no such/i.test(message);
          if (looksMissing) {
            sections.push(`${gym.name}`, `  (no snapshot yet — first scrape hasn't completed)`);
          } else {
            sections.push(
              `${gym.name}`,
              `  ⚠ SNAPSHOT UNREACHABLE: ${message.slice(0, 120)}`,
              `  (operator action needed — check Vercel Blob + scraper logs)`,
            );
          }
        }
        sections.push("");
      }
      return sections.join("\n").trim();
    }
    case "/refresh":
      if (!ctx.dispatchRefresh) return "Refresh is not configured (GITHUB_PAT missing).";
      try {
        await ctx.dispatchRefresh();
        return "Refresh started, takes ~5 min. Ask /snapshot in a bit to verify.";
      } catch (e) {
        return `Couldn't trigger refresh: ${(e as Error).message}`;
      }
    case "/approve":
      if (!ctx.allowlistStore) return "Allowlist storage is not configured.";
      if (!ctx.isOwner) return "Only the owner can approve users.";
      return await handleApprove(ctx);
    case "/revoke":
      if (!ctx.allowlistStore) return "Allowlist storage is not configured.";
      if (!ctx.isOwner) return "Only the owner can revoke users.";
      return await handleRevoke(ctx);
    case "/allowlist":
      if (!ctx.allowlistStore) return "Allowlist storage is not configured.";
      if (!ctx.isOwner) return "Only the owner can view the allowlist.";
      return await handleListAllowlist(ctx);
    default:
      return null;
  }
}

async function handleApprove(ctx: SlashContext): Promise<string> {
  const parts = ctx.text.trim().split(/\s+/);
  const idStr = parts[1];
  const name = parts.slice(2).join(" ").trim() || undefined;
  const id = Number(idStr);
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    return "Usage: /approve <chat_id> [optional name]\n\nGet the chat_id from the bot's \"Not authorized\" reply to that user.";
  }
  const entry: AllowlistEntry = {
    chatId: id,
    name,
    addedAt: new Date().toISOString(),
    addedBy: ctx.chatId,
  };
  try {
    await ctx.allowlistStore!.add(entry);
    return `✅ Approved chat ${id}${name ? ` (${name})` : ""}. They can use the bot now.`;
  } catch (e) {
    return `Couldn't update allowlist: ${(e as Error).message}`;
  }
}

async function handleRevoke(ctx: SlashContext): Promise<string> {
  const parts = ctx.text.trim().split(/\s+/);
  const id = Number(parts[1]);
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    return "Usage: /revoke <chat_id>";
  }
  try {
    const next = await ctx.allowlistStore!.remove(id);
    return `Removed chat ${id}. ${next.approved.length} approved user(s) remain.`;
  } catch (e) {
    return `Couldn't update allowlist: ${(e as Error).message}`;
  }
}

async function handleListAllowlist(ctx: SlashContext): Promise<string> {
  try {
    const al = await ctx.allowlistStore!.read();
    if (al.approved.length === 0) {
      return "No additional approved users (owner set is in env var).";
    }
    const lines = ["Approved (besides owner set):"];
    for (const e of al.approved) {
      lines.push(`  • ${e.chatId}${e.name ? ` — ${e.name}` : ""} (added ${e.addedAt.slice(0, 10)})`);
    }
    return lines.join("\n");
  } catch (e) {
    return `Couldn't read allowlist: ${(e as Error).message}`;
  }
}
