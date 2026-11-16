#!/usr/bin/env node
/**
 * Runs the end-to-end scenarios against a real page with the built extension loaded in a
 * headless Edge/Chromium. See e2e/README.md. Usage:
 *
 *   npm run test:e2e                       # builds, then runs every scenario
 *   node e2e/run.mjs --scenario=click,text # run some, against the current dist/
 *   node e2e/run.mjs --headed              # show the browser windows
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Browser } from "./lib/browser.mjs";
import { loadConfig } from "./lib/config.mjs";
import { scenarios } from "./scenarios.mjs";

const config = loadConfig();

if (!config.url) {
  console.error("E2E_URL is not set. Put it in .env (see .env.example) or pass --url=<url>.");
  process.exit(2);
}
if (!existsSync(join(config.extension, "manifest.json"))) {
  console.error(`No built extension in ${config.extension}. Run the build first.`);
  process.exit(2);
}

const selected = config.scenarios.length
  ? scenarios.filter((scenario) => config.scenarios.includes(scenario.name))
  : scenarios;
const unknown = config.scenarios.filter((name) => !scenarios.some((s) => s.name === name));
if (unknown.length) {
  console.error(
    `Unknown scenario(s): ${unknown.join(", ")}. Known: ${scenarios.map((s) => s.name).join(", ")}`,
  );
  process.exit(2);
}

const host = (() => {
  try {
    return new URL(config.url).host;
  } catch {
    return "(invalid URL)";
  }
})();
// The full URL stays out of the output on purpose; only its host is shown.
console.log(`Browser: ${config.browser}`);
console.log(`Page:    ${host} (from E2E_URL)`);
console.log(
  `Windows: ${config.size.width}x${config.size.height}, small ${config.smallSize.width}x${config.smallSize.height}`,
);
console.log("");

const browser = await Browser.launch(config);
let failed = 0;

try {
  let worker;
  for (const end = Date.now() + config.timeout; !worker && Date.now() < end;) {
    worker = await browser.extensionWorker();
    if (!worker) await new Promise((r) => setTimeout(r, 300));
  }
  if (!worker) throw new Error("The extension's service worker never started.");
  console.log(`Extension worker: ${worker.url}\n`);

  for (const scenario of selected) {
    const checks = [];
    const notes = [];
    const ctx = {
      browser,
      config,
      check(label, ok, detail = "") {
        checks.push({ label, ok: Boolean(ok), detail: String(detail ?? "") });
      },
      /** Something worth knowing that isn't a check (e.g. a setup step that needed help). */
      note(text) {
        notes.push(text);
      },
    };

    const started = Date.now();
    let error;
    try {
      await scenario.run(ctx);
    } catch (err) {
      error = err;
    }
    const ok = !error && checks.every((check) => check.ok);
    if (!ok) {
      failed += 1;
      for (const [index, page] of browser.pages.entries()) {
        const file = await page
          .screenshot(config.output, `${scenario.name}-${index + 1}`)
          .catch(() => null);
        if (file) checks.push({ label: `screenshot ${index + 1}`, ok: true, detail: file });
      }
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${scenario.name}  (${seconds}s)  ${scenario.description}`,
    );
    for (const check of checks) {
      console.log(`      ${check.ok ? "ok  " : "FAIL"} ${check.label}`);
      if (check.detail && !check.ok) {
        for (const line of check.detail.split("\n").slice(0, 6)) console.log(`           ${line}`);
      }
    }
    for (const note of notes) console.log(`      note ${note}`);
    if (error) console.log(`      error: ${error.message}`);
    await browser.closePages();
  }
} catch (err) {
  failed += 1;
  console.error(`\n${err.message}`);
} finally {
  await browser.close();
}

console.log(`\n${selected.length - failed}/${selected.length} scenarios passed.`);
process.exit(failed ? 1 : 0);
