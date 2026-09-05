import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    maxWorkers: 4,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json", "lcov"],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 80,
        branches: 80,
        "src/domain/evidence/**": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 100,
        },
        "src/domain/evidence-graph/**": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 100,
        },
        "src/domain/official-rules/**": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 100,
        },
        "src/domain/fraud/**": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 100,
        },
        "src/domain/reporting/**": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 100,
        },
        "src/domain/non-natural-death-disclosure/**": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 100,
        },
        "src/application/conversation/normalize-turn.ts": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 100,
        },
        "src/application/pipeline/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        "src/application/processing/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        "src/application/ocr/**": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        "src/application/jobs/job-worker.ts": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
        "src/adapters/**": {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 75,
        },
        "src/components/**": {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 75,
        },
      },
      exclude: ["src/components/ui/**", "src/**/*.d.ts"],
    },
  },
});
