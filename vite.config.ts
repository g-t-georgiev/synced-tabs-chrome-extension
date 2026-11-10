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
    restoreMocks: true,
    unstubGlobals: true,
  },
});
