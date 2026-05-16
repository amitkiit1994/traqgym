export interface LatestPointer {
  snapshot_date: string;
  snapshot_ist: string;
  row_counts: Record<string, number>;
  blob_urls: Record<string, string>;
}

export interface BlobStore {
  fetchLatest(): Promise<LatestPointer>;
  fetchCsv(name: string): Promise<string>;
}

export interface BlobStoreOptions {
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
    if (!res.ok) throw new Error(`latest.json fetch failed: ${res.status}`);
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
        `Unknown CSV: ${name}. Available: ${Object.keys(pointer.blob_urls).join(", ")}`,
      );
    }
    const hit = csvCache.get(name);
    if (hit) return hit;
    const res = await fetcher(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`CSV ${name} fetch failed: ${res.status}`);
    const text = await res.text();
    csvCache.set(name, text);
    return text;
  }

  return { fetchLatest, fetchCsv };
}
