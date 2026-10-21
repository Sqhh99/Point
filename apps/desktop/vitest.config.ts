import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Main-process integration tests. better-sqlite3 is rebuilt for Electron's ABI by
// postinstall, so these run inside Electron-as-Node (see scripts/test-main.mjs).
export default defineConfig({
  resolve: {
    alias: {
      // Renderer modules under test import this subpath (first match wins, so it precedes "@point/core").
      "@point/core/rendered-map": fileURLToPath(new URL("../../packages/core/src/conversations/rendered-map.ts", import.meta.url)),
      "@point/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))
    }
  },
  test: { include: ["test/main/**/*.test.ts"], pool: "forks", fileParallelism: false }
});
