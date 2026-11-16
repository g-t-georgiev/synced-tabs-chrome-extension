import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    endOfLine: "lf",
    tabWidth: 2,
    semi: true,
    singleQuote: false,
    trailingComma: "all",
  },
  lint: {
    ignorePatterns: ["dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    // Creates happy-dom once per worker instead of once per test file, while still giving
    // each file its own isolated context: about twice as fast as the default forks pool.
    pool: "vmThreads",
    restoreMocks: true,
    unstubGlobals: true,
  },
});
