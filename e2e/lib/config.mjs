import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "vite";

/**
 * E2E settings from `.env` files (`.env`, `.env.local`, `.env.e2e`, `.env.e2e.local`) and
 * the process environment, all prefixed `E2E_` so Vite never inlines them into the
 * extension. Documented in `.env.example`; command-line flags override them:
 *
 *   --url=<url> --browser=<path> --headed --scenario=<a,b> --size=<WxH> --timeout=<ms>
 */

/** Browsers that load an unpacked extension from the command line (branded Chrome doesn't). */
const BROWSER_CANDIDATES = [
  process.env["ProgramFiles(x86)"] &&
    `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  process.env.ProgramFiles &&
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/microsoft-edge",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function flags(argv) {
  const out = {};
  for (const arg of argv) {
    const [, key, value] = /^--([^=]+)(?:=(.*))?$/.exec(arg) ?? [];
    if (key) out[key] = value ?? "true";
  }
  return out;
}

/** "1280x720" → { width, height }; `fallback` when `value` is missing or malformed. */
function size(value, fallback) {
  const pattern = /^(\d+)\s*x\s*(\d+)$/i;
  const [, w, h] = pattern.exec(value ?? "") ?? pattern.exec(fallback);
  return { width: Number(w), height: Number(h) };
}

const bool = (value, fallback) =>
  value === undefined || value === "" ? fallback : !/^(0|false|no|off)$/i.test(value);

export function loadConfig(argv = process.argv.slice(2), cwd = process.cwd()) {
  const env = { ...loadEnv("e2e", cwd, "E2E_"), ...pick(process.env) };
  const cli = flags(argv);

  const browser = cli.browser ?? env.E2E_BROWSER ?? BROWSER_CANDIDATES.find((p) => existsSync(p));
  const url = cli.url ?? env.E2E_URL;

  return {
    url,
    browser,
    /** The unpacked extension to load. */
    extension: resolve(cwd, env.E2E_EXTENSION_DIR ?? "dist"),
    headless: cli.headed ? false : bool(env.E2E_HEADLESS, true),
    /** Scenario names to run; all when empty. */
    scenarios: (cli.scenario ?? env.E2E_SCENARIOS ?? "").split(/[\s,]+/).filter(Boolean),
    /** Viewport of every window, and of the smaller window in size-mismatch scenarios. */
    size: size(cli.size ?? env.E2E_WINDOW_SIZE, "1280x720"),
    smallSize: size(env.E2E_SMALL_WINDOW_SIZE, "960x540"),
    timeout: Number(cli.timeout ?? env.E2E_TIMEOUT_MS ?? 30000),
    /** Extra wait after the page is ready (animations, splash), ms. */
    settle: Number(env.E2E_SETTLE_MS ?? 1500),
    /** Where screenshots of failed checks go. */
    output: resolve(cwd, env.E2E_OUTPUT_DIR ?? "e2e/output"),
    /** Page elements the scenarios use. */
    selectors: {
      /** Visible text of a button that's mirrored with a click (the game's splash button). */
      clickText: env.E2E_CLICK_TEXT ?? "START",
      /** Something cheap to click repeatedly (opens/closes the debug panel). */
      toggle: env.E2E_TOGGLE_SELECTOR ?? ".tp-toggle-btn",
      /** Text fields to type into once the toggle has been clicked. */
      textField: env.E2E_TEXT_FIELD_SELECTOR ?? "input.tp-txtv_i",
    },
  };
}

function pick(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => key.startsWith("E2E_")));
}
