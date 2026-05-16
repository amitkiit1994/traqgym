"use client";

import { useState, useTransition } from "react";
import {
  disconnectFitnessboard,
  queueManualSync,
  saveFitnessboardConfig,
  validateFitnessboardLogin,
  type FitnessboardStatus,
} from "@/lib/actions/fitnessboard-setup";

function statusColor(s?: string): string {
  if (!s) return "bg-muted text-muted-foreground";
  if (s.startsWith("ok")) return "bg-green-50 dark:bg-green-950/30 border-green-500/40";
  if (s.startsWith("queued")) return "bg-amber-50 dark:bg-amber-950/30 border-amber-500/40";
  if (s.startsWith("err") || s.startsWith("fail")) return "bg-destructive/10 border-destructive/40";
  return "bg-muted border-border";
}

export function FitnessboardSetupForm({
  initialStatus,
}: {
  initialStatus: FitnessboardStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [mobile, setMobile] = useState(initialStatus.mobile ?? "");
  const [password, setPassword] = useState("");
  const [syncEnabled, setSyncEnabled] = useState(initialStatus.syncEnabled ?? false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [testing, startTest] = useTransition();
  const [saving, startSave] = useTransition();
  const [queuing, startQueue] = useTransition();

  return (
    <div className="space-y-6">
      {/* Status panel */}
      {status.configured ? (
        <div className="rounded-lg border bg-card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={
                  "inline-block size-2 rounded-full " +
                  (status.syncEnabled ? "bg-green-500" : "bg-muted-foreground")
                }
              />
              <h2 className="font-semibold">
                {status.syncEnabled ? "Sync enabled" : "Configured (sync paused)"}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!confirm("Disconnect v3 sync? Saved credentials will be wiped.")) return;
                startSave(async () => {
                  await disconnectFitnessboard();
                  setStatus({ configured: false });
                  setMobile("");
                  setPassword("");
                  setSyncEnabled(false);
                  setMessage({ type: "ok", text: "Disconnected." });
                });
              }}
              disabled={saving}
              className="text-xs text-destructive underline disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
          <div className="text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">v3 mobile:</span>{" "}
              <code className="rounded bg-muted px-1.5 py-0.5">{status.mobile}</code>
            </div>
            {status.lastSyncAt ? (
              <div>
                <span className="text-muted-foreground">Last sync:</span>{" "}
                {new Date(status.lastSyncAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </div>
            ) : (
              <div className="text-muted-foreground">No sync has run yet.</div>
            )}
            {status.lastSyncStatus ? (
              <div className={"rounded-md border p-2 text-xs mt-2 " + statusColor(status.lastSyncStatus)}>
                {status.lastSyncStatus}
              </div>
            ) : null}
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                startQueue(async () => {
                  const res = await queueManualSync();
                  setMessage({ type: "ok", text: res.message });
                  setStatus((s) => ({ ...s, lastSyncStatus: `queued: manual run requested at ${new Date().toISOString()}` }));
                });
              }}
              disabled={queuing}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {queuing ? "Queuing…" : "Run sync now"}
            </button>
            <p className="text-xs text-muted-foreground mt-1">
              Queues a sync that will run on next nightly cron. For immediate
              runs, trigger the GitHub workflow manually.
            </p>
          </div>
        </div>
      ) : null}

      {/* Config form */}
      <form
        className="rounded-lg border bg-card p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          startSave(async () => {
            const res = await saveFitnessboardConfig({ mobile, password, syncEnabled });
            if (res.success) {
              setStatus({
                configured: true,
                mobile,
                syncEnabled,
                lastSyncAt: status.lastSyncAt,
                lastSyncStatus: status.lastSyncStatus,
              });
              setPassword("");
              setMessage({ type: "ok", text: "Saved. Sync will run on next cron." });
            } else {
              setMessage({ type: "err", text: res.error });
            }
          });
        }}
      >
        <h2 className="font-semibold">
          {status.configured ? "Update credentials" : "Connect v3 account"}
        </h2>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={(e) => setSyncEnabled(e.target.checked)}
            className="size-4"
          />
          <span>Sync from FitnessBoard v3 nightly</span>
        </label>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="v3-mobile">
            Mobile (10 digits)
          </label>
          <input
            id="v3-mobile"
            type="tel"
            inputMode="numeric"
            pattern="\d{10}"
            autoComplete="off"
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder="9876543210"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="v3-password">
            Password
          </label>
          <input
            id="v3-password"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={status.configured ? "(unchanged — leave blank to keep)" : "v3 dashboard password"}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            required={!status.configured}
          />
          <p className="text-xs text-muted-foreground">
            Encrypted at rest. Used only by the nightly sync runner.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              startTest(async () => {
                const res = await validateFitnessboardLogin(mobile, password);
                setMessage(
                  res.success
                    ? { type: "ok", text: "Login OK — v3 accepted these credentials." }
                    : { type: "err", text: res.error }
                );
              });
            }}
            disabled={!mobile || !password || testing || saving}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            type="submit"
            disabled={!mobile || (!password && !status.configured) || saving || testing}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
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
    </div>
  );
}
