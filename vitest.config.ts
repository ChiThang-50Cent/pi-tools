import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extensions/tools/__tests__/**/*.test.ts"],
    globals: false,
  },
});
