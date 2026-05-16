import type { BlobStore } from "./data/blob-store.js";

export interface SlashContext {
  text: string;
  chatId: number;
  firstName: string;
  store: BlobStore;
  dispatchRefresh?: () => Promise<void>;
}

const HELP = [
  "Try asking:",
  "  • How much did we collect 1-7 April?",
  "  • PT revenue vs gym revenue last week",
  "  • Who paid in cash on 4 April?",
  "  • Total members joined this month",
  "  • Is <member name> active?",
  "",
  "Commands: /start /help /snapshot /refresh /ping",
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
      const p = await ctx.store.fetchLatest();
      const lines = [
        `Last refresh: ${p.snapshot_ist}`,
        `Snapshot date: ${p.snapshot_date}`,
        "",
        "Row counts:",
        ...Object.entries(p.row_counts).map(([k, v]) => `  • ${k}: ${v}`),
      ];
      return lines.join("\n");
    }
    case "/refresh":
      if (!ctx.dispatchRefresh) return "Refresh is not configured (GITHUB_PAT missing).";
      try {
        await ctx.dispatchRefresh();
        return "Refresh started, takes ~5 min. Ask /snapshot in a bit to verify.";
      } catch (e) {
        return `Couldn't trigger refresh: ${(e as Error).message}`;
      }
    default:
      return null;
  }
}
