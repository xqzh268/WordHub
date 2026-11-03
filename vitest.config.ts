import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "apps/desktop/src/**/*.test.ts",
    ],
    // CI 的 Windows 机器负载高时，本地几百毫秒的用例也会超过默认的 5 秒（已连续几次因此误报失败）。
    testTimeout: 30000,
  },
});
