import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./") + "/",
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30000, // 30s per test (network calls)
    hookTimeout: 15000, // 15s for beforeAll login
    fileParallelism: false, // integration tests share DB state
    sequence: {
      // Run test files in order (01-auth before 02-kiosk, etc.)
      sequencer: class {
        async shard(files: any[]) { return files; }
        async sort(files: any[]) {
          return files.sort((a: any, b: any) => {
            const nameA = typeof a === 'string' ? a : a.id || a.filepath || '';
            const nameB = typeof b === 'string' ? b : b.id || b.filepath || '';
            return String(nameA).localeCompare(String(nameB));
          });
        }
      },
    },
  },
});
