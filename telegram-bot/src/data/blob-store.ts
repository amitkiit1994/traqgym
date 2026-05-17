/**
 * Per-gym CSV snapshot store backed by Vercel Blob.
 *
 * Layout (single Blob store, gym-scoped prefixes):
 *   csv/<gym>/latest.json
 *   csv/<gym>/YYYY-MM-DD/<csvname>.csv
 *
 * The store is constructed once per gym from a shared base URL
 * (`BLOB_BASE_URL` env, e.g. `https://<store>.public.blob.vercel-storage.com`).
 * Each instance owns its own in-memory 60s pointer cache + per-CSV cache.
 */

export interface LatestPointer {
  snapshot_date: string;
  snapshot_ist: string;
  row_counts: Record<string, number>;
  blob_urls: Record<string, string>;
}

export interface BlobStore {
  /** Gym slug this store is scoped to. */
  readonly gym: string;
  fetchLatest(): Promise<LatestPointer>;
  fetchCsv(name: string): Promise<string>;
}

export interface BlobStoreOptions {
  gym: string;
  latestUrl: string;
  fetch?: typeof fetch;
  cacheTtlMs?: number;
}

export function createBlobStore(opts: BlobStoreOptions): BlobStore {
  const fetcher = opts.fetch ?? globalThis.fetch;
  const ttl = opts.cacheTtlMs ?? 60_000;
  let cached: { pointer: LatestPointer; at: number } | null = null;
  const csvCache = new Map<string, string>();

  async function fetchLatest(): Promise<LatestPointer> {
    if (cached && Date.now() - cached.at < ttl) return cached.pointer;
    const res = await fetcher(opts.latestUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`latest.json fetch failed for gym '${opts.gym}': ${res.status}`);
    const pointer = (await res.json()) as LatestPointer;
    cached = { pointer, at: Date.now() };
    csvCache.clear();
    return pointer;
  }

  async function fetchCsv(name: string): Promise<string> {
    const pointer = await fetchLatest();
    const url = pointer.blob_urls[name];
    if (!url) {
      throw new Error(
        `Unknown CSV: ${name} in gym '${opts.gym}'. Available: ${Object.keys(pointer.blob_urls).join(", ")}`,
      );
    }
    const hit = csvCache.get(name);
    if (hit) return hit;
    const res = await fetcher(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV ${name} fetch failed for gym '${opts.gym}': ${res.status}`);
    const text = await res.text();
    csvCache.set(name, text);
    return text;
  }

  return { gym: opts.gym, fetchLatest, fetchCsv };
}

/**
 * Derive the `csv/<gym>/latest.json` URL from a shared Blob base URL.
 *
 * Examples:
 *   baseUrl = "https://abc.public.blob.vercel-storage.com"
 *   gym     = "freeform"
 *   returns   "https://abc.public.blob.vercel-storage.com/csv/freeform/latest.json"
 */
export function buildLatestUrl(baseUrl: string, gym: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/csv/${gym}/latest.json`;
}

/**
 * Cache of per-gym blob stores. Avoids spinning up a new store + losing
 * its pointer cache on every request to the same gym.
 */
export class BlobStoreRegistry {
  private readonly stores = new Map<string, BlobStore>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly cacheTtlMs: number = 60_000,
  ) {}

  for(gym: string): BlobStore {
    const existing = this.stores.get(gym);
    if (existing) return existing;
    const created = createBlobStore({
      gym,
      latestUrl: buildLatestUrl(this.baseUrl, gym),
      fetch: this.fetcher,
      cacheTtlMs: this.cacheTtlMs,
    });
    this.stores.set(gym, created);
    return created;
  }
}
