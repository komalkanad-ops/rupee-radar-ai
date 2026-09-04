import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Integration tests share one real (test) database and create/tear down their own rows —
    // running them in parallel workers risks cross-test interference on shared tables like
    // SubscriptionProvider or the admin bootstrap check. Sequential is slower but deterministic.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    globalSetup: "./test/globalSetup.ts",
  },
});
