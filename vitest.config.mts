import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup/polyfills.ts", "./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    // #100: under a full parallel run, jsdom setup plus userEvent typing can
    // push a UI test past the 5 s default though it passes alone in ~1 s.
    // A wider ceiling stops load-only flakes; real hangs still fail.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
