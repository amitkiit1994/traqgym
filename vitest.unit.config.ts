import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // No globalSetup — pure unit tests don't need DB
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
