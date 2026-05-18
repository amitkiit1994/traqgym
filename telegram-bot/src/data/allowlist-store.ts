import { put } from "@vercel/blob";

/**
 * Dynamic allowlist stored in Vercel Blob (alongside csv/latest.json).
 * The env-var TELEGRAM_ALLOWED_CHAT_IDS defines the *owner* set (people who
 * can /approve others). This file adds non-owner approved chat IDs.
 *
 * Schema: { approved: [{ chatId, name?, addedAt, addedBy }] }
 */

export interface AllowlistEntry {
  chatId: number;
  name?: string;
  addedAt: string;     // ISO timestamp
  addedBy: number;     // chat ID of the approver
}

export interface Allowlist {
  approved: AllowlistEntry[];
}

const EMPTY: Allowlist = { approved: [] };

export interface AllowlistStore {
  read(): Promise<Allowlist>;
  add(entry: AllowlistEntry): Promise<Allowlist>;
  remove(chatId: number): Promise<Allowlist>;
}

export interface AllowlistStoreOptions {
  url: string;          // public URL of allowlist.json
  token: string;        // BLOB_READ_WRITE_TOKEN (needed for writes)
  fetch?: typeof fetch;
  cacheTtlMs?: number;
}

export function createAllowlistStore(opts: AllowlistStoreOptions): AllowlistStore {
  const fetcher = opts.fetch ?? globalThis.fetch;
  const ttl = opts.cacheTtlMs ?? 30_000;
  let cached: { value: Allowlist; at: number } | null = null;

  async function read(): Promise<Allowlist> {
    if (cached && Date.now() - cached.at < ttl) return cached.value;
    const res = await fetcher(opts.url, { cache: "no-store" });
    let value: Allowlist;
    if (res.status === 404) {
      // First-ever bot deploy hasn't had any /approve calls yet — file
      // genuinely doesn't exist, empty list is correct.
      value = EMPTY;
    } else if (!res.ok) {
      throw new Error(`allowlist.json fetch failed: ${res.status}`);
    } else {
      // Distinguish "file is corrupt / wrong shape" from "file is empty
      // {approved: []}". Silently substituting EMPTY for corrupt data
      // would lock out every previously-approved user with no signal,
      // and the next /approve write would erase whatever was actually
      // there. Throw loudly instead so the caller logs + the operator
      // sees the cause.
      let raw: unknown;
      try {
        raw = await res.json();
      } catch (e) {
        throw new Error(
          `allowlist.json is not valid JSON at ${opts.url}: ${(e as Error).message}`,
        );
      }
      if (!raw || typeof raw !== "object" || !Array.isArray((raw as Allowlist).approved)) {
        console.error(
          `[allowlist] CORRUPT: allowlist.json at ${opts.url} has wrong shape ` +
          `(expected {approved: [...]}, got ${JSON.stringify(raw).slice(0, 120)}). ` +
          `Refusing to substitute empty list — previously-approved users would be erased.`,
        );
        throw new Error("allowlist.json shape invalid (expected {approved:[...]} object)");
      }
      value = raw as Allowlist;
    }
    cached = { value, at: Date.now() };
    return value;
  }

  async function write(value: Allowlist): Promise<void> {
    await put("allowlist.json", JSON.stringify(value, null, 2), {
      access: "public",
      contentType: "application/json",
      token: opts.token,
      addRandomSuffix: false,
      allowOverwrite: true,
    } as Parameters<typeof put>[2]);
    cached = { value, at: Date.now() };
  }

  // Force a fresh read from the blob (bypass 30s cache) — used by mutate
  // paths so concurrent /approve and /revoke can't write stale state on
  // top of each other. Still racy if two writes interleave (Vercel Blob
  // has no CAS), but at least the read side always sees the latest.
  async function readFresh(): Promise<Allowlist> {
    cached = null;
    return read();
  }

  async function add(entry: AllowlistEntry): Promise<Allowlist> {
    const current = await readFresh();
    const without = current.approved.filter(e => e.chatId !== entry.chatId);
    const next: Allowlist = { approved: [...without, entry] };
    await write(next);
    return next;
  }

  async function remove(chatId: number): Promise<Allowlist> {
    const current = await readFresh();
    const next: Allowlist = {
      approved: current.approved.filter(e => e.chatId !== chatId),
    };
    await write(next);
    return next;
  }

  return { read, add, remove };
}
