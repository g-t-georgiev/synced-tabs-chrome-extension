import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build, loadEnv } from "vite";
import { parseTargetMatches } from "../src/shared/target-matches.ts";

const watch = process.argv.includes("--watch");
const mode = watch ? "development" : "production";

const targets = [
  { name: "background", entry: "src/background/index.ts", format: "es" },
  { name: "content", entry: "src/content/index.ts", format: "iife" },
];

/**
 * Settings from `.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` (see
 * `.env.example`). Vite also inlines these `VITE_*` values into the bundles.
 */
const env = loadEnv(mode, process.cwd(), "VITE_");
const matches = parseTargetMatches(env.VITE_TARGET_MATCHES, (message) => console.warn(message));
if (!env.VITE_TARGET_MATCHES) {
  console.warn(
    `VITE_TARGET_MATCHES is not set (see .env.example): mirroring only ${matches.join(", ")}.`,
  );
}

/** The manifest template with this build's content-script matches. */
async function writeManifest() {
  const manifest = JSON.parse(await readFile("src/manifest.json", "utf8"));
  manifest.content_scripts[0].matches = matches;
  await mkdir("dist", { recursive: true });
  await writeFile("dist/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
}

await rm("dist", { recursive: true, force: true });
await writeManifest();

for (const target of targets) {
  await build({
    configFile: false,
    mode,
    publicDir: false,
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
