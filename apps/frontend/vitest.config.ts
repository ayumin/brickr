import { defineConfig } from "vitest/config";

/**
 * The frontend's only unit tests cover pure derived-thread logic, so a node
 * environment is enough — no DOM, no jsdom dependency.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
