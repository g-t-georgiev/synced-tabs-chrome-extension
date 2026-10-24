import { rm } from "node:fs/promises";
import { build } from "vite";

const watch = process.argv.includes("--watch");

const targets = [
  { name: "background", entry: "src/background/index.ts", format: "es" },
  { name: "content", entry: "src/content/index.ts", format: "iife" },
];

await rm("dist", { recursive: true, force: true });

for (const [index, target] of targets.entries()) {
  await build({
    configFile: false,
    mode: watch ? "development" : "production",
    publicDir: index === 0 ? "public" : false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      target: "chrome120",
      sourcemap: watch ? "inline" : false,
      minify: !watch,
      watch: watch ? {} : null,
      lib: {
        entry: target.entry,
        formats: [target.format],
        name: "MirrorSync",
        fileName: () => `${target.name}.js`,
      },
    },
  });
}