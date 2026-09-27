import { defineConfig } from "vitest/config";

// Pure-logic tests only; kept separate from vite.config.ts so the Cloudflare plugin doesn't load.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
