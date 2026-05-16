import type { AgentInputItem } from "@openai/agents";
import { loadConfig } from "../src/config.js";
import { isAllowed, checkSecretToken } from "../src/auth.js";
import { createRateLimiter } from "../src/rate-limit.js";
import { sendTelegramMessage } from "../src/telegram/send-message.js";
import { handleSlashCommand } from "../src/commands.js";
import { createBlobStore } from "../src/data/blob-store.js";
import { createGithubDispatcher } from "../src/github-dispatch.js";
import { runLlm } from "../src/llm.js";

const config = loadConfig();
const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

// Per-chat conversation history. In-memory means it resets on each Vercel
// cold start, which is fine for a low-volume 2-user bot: warm container
// keeps memory for the active conversation, cold start drops history but
// next message rebuilds it. Capped to last MAX_HISTORY items to bound
// token cost and memory.
const MAX_HISTORY = 30;
const RESET_KEYWORDS = /^\s*\/(reset|new|forget)\b/i;
const historyByChat = new Map<number, AgentInputItem[]>();

const blobStore = createBlobStore({ latestUrl: config.blobLatestUrl });
const dispatcher = createGithubDispatcher({
  pat: config.githubPat,
  repo: config.githubRepo,
  workflow: "refresh-export.yml",
});

// OpenAI Agents SDK auto-reads OPENAI_API_KEY from env.
process.env.OPENAI_API_KEY = config.openaiApiKey;

interface TelegramUpdate {
  message?: {
    chat: { id: number; type: string };
    from?: { first_name?: string; username?: string };
    text?: string;
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const tokenHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (
    !checkSecretToken(
      typeof tokenHeader === "string" ? tokenHeader : undefined,
      config.webhookSecret,
    )
  ) {
    res.status(401).end();
    return;
  }

  const update = req.body as TelegramUpdate;
  const msg = update?.message;
  if (!msg || !msg.text) {
    res.status(200).end();
    return;
  }

  const chatId = msg.chat.id;
  const firstName = msg.from?.first_name ?? "there";
  const text = msg.text;

  if (!isAllowed(chatId, config.allowedChatIds)) {
    await sendTelegramMessage({
      token: config.telegramBotToken,
      chatId,
      text: "Not authorized.",
    });
    res.status(200).end();
    return;
  }

  if (!rateLimiter.check(chatId)) {
    await sendTelegramMessage({
      token: config.telegramBotToken,
      chatId,
      text: "Slow down a sec — try again in a moment.",
    });
    res.status(200).end();
    return;
  }

  // /reset, /new, /forget — clear conversation memory before handling.
  if (RESET_KEYWORDS.test(text)) {
    historyByChat.delete(chatId);
    await sendTelegramMessage({
      token: config.telegramBotToken,
      chatId,
      text: "Cleared. Start fresh.",
    });
    res.status(200).end();
    return;
  }

  try {
    const slash = await handleSlashCommand({
      text,
      chatId,
      firstName,
      store: blobStore,
      dispatchRefresh: dispatcher,
    });

    let reply: string;
    let toolCalls = 0;
    let snapshotDate = "?";
    if (slash !== null) {
      reply = slash;
    } else {
      const llm = await runLlm({
        question: text,
        model: config.openaiModel,
        store: blobStore,
        history: historyByChat.get(chatId) ?? [],
      });
      reply = llm.text;
      toolCalls = llm.toolCalls;
      snapshotDate = llm.snapshotDate;
      // Persist updated history, capped to last MAX_HISTORY items.
      const trimmed = llm.history.slice(-MAX_HISTORY);
      historyByChat.set(chatId, trimmed);
    }

    await sendTelegramMessage({
      token: config.telegramBotToken,
      chatId,
      text: reply,
    });

    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      chat_id: chatId,
      q: text.slice(0, 200),
      n_tool_calls: toolCalls,
      model: config.openaiModel,
      latency_ms: Date.now() - started,
      snapshot_date: snapshotDate,
      answer_preview: reply.slice(0, 200),
    }));
    res.status(200).end();
  } catch (e) {
    console.error("webhook error", e);
    try {
      await sendTelegramMessage({
        token: config.telegramBotToken,
        chatId,
        text: "Something broke on my side — try again in a minute.",
      });
    } catch {
      // swallow secondary failure
    }
    res.status(200).end();
  }
}
