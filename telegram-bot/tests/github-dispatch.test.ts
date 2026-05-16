import { describe, it, expect, vi } from "vitest";
import { createGithubDispatcher } from "../src/github-dispatch.js";

describe("createGithubDispatcher", () => {
  it("returns undefined when PAT missing", () => {
    const d = createGithubDispatcher({ pat: undefined, repo: "a/b", workflow: "x.yml" });
    expect(d).toBeUndefined();
  });
  it("POSTs to workflow dispatches endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const d = createGithubDispatcher({
      pat: "PAT", repo: "a/b", workflow: "x.yml", fetch: fetchMock,
    })!;
    await d();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/a/b/actions/workflows/x.yml/dispatches",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer PAT");
  });
  it("throws on non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    const d = createGithubDispatcher({
      pat: "PAT", repo: "a/b", workflow: "x.yml", fetch: fetchMock,
    })!;
    await expect(d()).rejects.toThrow(/401/);
  });
});
