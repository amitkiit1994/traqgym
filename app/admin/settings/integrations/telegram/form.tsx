"use client";

import { useState, useTransition } from "react";
import {
  configureBot,
  disconnectBot,
  validateBotToken,
  type SetupStatus,
} from "@/lib/actions/telegram-setup";

export function TelegramSetupForm({
  initialStatus,
}: {
  initialStatus: SetupStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [validating, startValidate] = useTransition();
  const [saving, startSave] = useTransition();

  if (status.configured) {
    return (
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="inline-block size-2 rounded-full bg-green-500" />
          <h2 className="font-semibold">Bot connected</h2>
        </div>
        <div className="text-sm space-y-1">
          <div>
            <span className="text-muted-foreground">Bot:</span>{" "}
            <a
              className="underline font-medium"
              href={`https://t.me/${status.botUsername}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              @{status.botUsername}
            </a>
          </div>
          {status.ownerChatId ? (
            <div>
              <span className="text-muted-foreground">Owner chat:</span>{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">
                {status.ownerChatId}
              </code>{" "}
              <span className="text-green-600">(paired)</span>
            </div>
          ) : status.pairCode ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-3 mt-3">
              <div className="text-sm font-medium mb-1">
                Owner needs to pair (one-time):
              </div>
              <div className="text-sm">
                Open{" "}
                <a
                  className="underline"
                  href={`https://t.me/${status.botUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @{status.botUsername}
                </a>{" "}
                and send:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-bold">
                  /pair {status.pairCode}
                </code>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Code refreshes daily.
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!confirm("Disconnect the Telegram bot? Saved token and pairing will be removed.")) return;
            startSave(async () => {
              await disconnectBot();
              setStatus({ configured: false });
              setMessage({ type: "ok", text: "Disconnected." });
            });
          }}
          disabled={saving}
          className="text-sm text-destructive underline disabled:opacity-50"
        >
          Disconnect bot
        </button>
      </div>
    );
  }

  return (
    <form
      className="rounded-lg border bg-card p-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startSave(async () => {
          const res = await configureBot({ botToken: token });
          if (res.success) {
            setStatus({
              configured: true,
              botUsername: res.botUsername,
              pairCode: res.pairCode,
            });
            setMessage({ type: "ok", text: `Connected @${res.botUsername}.` });
            setToken("");
          } else {
            setMessage({ type: "err", text: res.error });
          }
        });
      }}
    >
      <h2 className="font-semibold">Connect a bot</h2>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="bot-token">
          Bot token from @BotFather
        </label>
        <input
          id="bot-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ-1234567890"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
          required
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            startValidate(async () => {
              const res = await validateBotToken(token);
              setMessage(
                res.success
                  ? {
                      type: "ok",
                      text: `Valid: @${res.botUsername} (${res.botName})`,
                    }
                  : { type: "err", text: res.error }
              );
            });
          }}
          disabled={!token || validating || saving}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {validating ? "Checking…" : "Test token"}
        </button>
        <button
          type="submit"
          disabled={!token || saving || validating}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Connecting…" : "Connect bot"}
        </button>
      </div>

      {message ? (
        <div
          className={
            "rounded-md p-3 text-sm " +
            (message.type === "ok"
              ? "border border-green-500/40 bg-green-50 dark:bg-green-950/30"
              : "border border-destructive/40 bg-destructive/10")
          }
        >
          {message.text}
        </div>
      ) : null}
    </form>
  );
}
