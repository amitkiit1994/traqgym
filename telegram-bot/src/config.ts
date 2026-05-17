import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  /** Base URL of the Vercel Blob store, e.g.
   *  "https://abc.public.blob.vercel-storage.com". Per-gym latest.json lives
   *  at "{BLOB_BASE_URL}/csv/{gym}/latest.json". Accepts the legacy
   *  BLOB_LATEST_URL value (with /csv/latest.json suffix) for transition. */
  BLOB_BASE_URL: z.string().url(),
  GITHUB_PAT: z.string().optional(),
  GITHUB_REPO: z.string().default("amitkiit1994/traqgym"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = {
  telegramBotToken: string;
  allowedChatIds: Set<number>;
  webhookSecret: string;
  openaiApiKey: string;
  openaiModel: string;
  blobReadWriteToken: string;
  blobBaseUrl: string;
  githubPat: string | undefined;
  githubRepo: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

/**
 * Accept either the new base URL form ("https://x.blob.com") or the legacy
 * pre-migration form ("https://x.blob.com/csv/latest.json"). Strip the
 * legacy suffix so callers always get a clean base.
 */
function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "").replace(/\/csv\/latest\.json$/i, "");
}

export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map(i => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  const idStrings = parsed.data.TELEGRAM_ALLOWED_CHAT_IDS.split(",").map(s => s.trim());
  const ids = new Set<number>();
  for (const s of idStrings) {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(
        `Invalid environment: TELEGRAM_ALLOWED_CHAT_IDS contains non-integer "${s}"`,
      );
    }
    ids.add(n);
  }
  return {
    telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
    allowedChatIds: ids,
    webhookSecret: parsed.data.WEBHOOK_SECRET,
    openaiApiKey: parsed.data.OPENAI_API_KEY,
    openaiModel: parsed.data.OPENAI_MODEL,
    blobReadWriteToken: parsed.data.BLOB_READ_WRITE_TOKEN,
    blobBaseUrl: normalizeBaseUrl(parsed.data.BLOB_BASE_URL),
    githubPat: parsed.data.GITHUB_PAT,
    githubRepo: parsed.data.GITHUB_REPO,
    logLevel: parsed.data.LOG_LEVEL,
  };
}
