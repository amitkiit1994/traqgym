import { AsyncLocalStorage } from "node:async_hooks";

// When AI agent tools call server actions, there's no browser session.
// This context flag lets auth guards know the call is already authenticated.
const aiContext = new AsyncLocalStorage<{ workerId: number; role: string }>();

export function runInAiContext<T>(ctx: { workerId: number; role: string }, fn: () => T): T {
  return aiContext.run(ctx, fn);
}

export function getAiContext() {
  return aiContext.getStore();
}
