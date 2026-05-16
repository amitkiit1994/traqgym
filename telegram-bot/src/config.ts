import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(1),
  GOOGLE_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  BLOB_LATEST_URL: z.string().url(),
  GITHUB_PAT: z.string().optional(),
  GITHUB_REPO: z.string().default("amitkumardas/freeformfitnessOS"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = {
  telegramBotToken: string;
  allowedChatIds: Set<number>;
  webhookSecret: string;
  googleApiKey: string;
  geminiModel: string;
  blobReadWriteToken: string;
  blobLatestUrl: string;
  githubPat: string | undefined;
  githubRepo: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

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
    googleApiKey: parsed.data.GOOGLE_API_KEY,
    geminiModel: parsed.data.GEMINI_MODEL,
    blobReadWriteToken: parsed.data.BLOB_READ_WRITE_TOKEN,
    blobLatestUrl: parsed.data.BLOB_LATEST_URL,
    githubPat: parsed.data.GITHUB_PAT,
    githubRepo: parsed.data.GITHUB_REPO,
    logLevel: parsed.data.LOG_LEVEL,
  };
}
