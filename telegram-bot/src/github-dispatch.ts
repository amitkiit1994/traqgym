import { redactSecrets } from "./redact.js";

export interface DispatchOptions {
  pat: string | undefined;
  repo: string;
  workflow: string;
  ref?: string;
  fetch?: typeof fetch;
}

export function createGithubDispatcher(
  opts: DispatchOptions,
): (() => Promise<void>) | undefined {
  if (!opts.pat) return undefined;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const url = `https://api.github.com/repos/${opts.repo}/actions/workflows/${opts.workflow}/dispatches`;
  const ref = opts.ref ?? "main";
  return async () => {
    const res = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `GitHub dispatch failed: ${res.status} ${redactSecrets(body).slice(0, 200)}`,
      );
    }
  };
}
