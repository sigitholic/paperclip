import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.mjs", "e2e/**/*.e2e.test.mjs"], fileParallelism: false } });
