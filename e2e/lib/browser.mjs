import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cdp } from "./cdp.mjs";
import { Page } from "./page.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A browser with the unpacked extension loaded, in a throwaway profile (never your own),
 * headless by default. Controlled over the DevTools Protocol.
 */
export class Browser {
  /** @param {{ browser: string; extension: string; headless: boolean; timeout: number }} config */
  static async launch(config) {
    if (!config.browser) {
      throw new Error(
        "No browser found. Set E2E_BROWSER to Edge or Chromium (branded Chrome ignores --load-extension).",
      );
    }
    const profile = await mkdtemp(join(tmpdir(), "window-mirror-sync-e2e-"));
    const args = [
      ...(config.headless ? ["--headless=new"] : []),
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--disable-extensions-except=${config.extension}`,
      `--load-extension=${config.extension}`,
      "--remote-debugging-port=0",
      "about:blank",
    ];
    const proc = spawn(config.browser, args, { stdio: "ignore" });

    // The browser writes its debugging port and path here once it's listening.
    let endpoint;
    for (const end = Date.now() + config.timeout; !endpoint && Date.now() < end;) {
      await sleep(200);
      const text = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
      const [port, path] = text.split(/\r?\n/);
      if (port && path) endpoint = `ws://127.0.0.1:${port}${path}`;
    }
    if (!endpoint) {
      proc.kill();
      throw new Error(`${config.browser} didn't start its debugging endpoint.`);
    }

    const cdp = await Cdp.connect(endpoint);
    return new Browser(cdp, proc, profile, config);
  }

  constructor(cdp, proc, profile, config) {
    this.cdp = cdp;
    this.proc = proc;
    this.profile = profile;
    this.config = config;
    /** @type {Page[]} */
    this.pages = [];
  }

  /** The extension's service worker, once running: `{ id, url }`, or undefined. */
  async extensionWorker() {
    const { targetInfos } = await this.cdp.send("Target.getTargets");
    const workers = targetInfos.filter(
      (t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"),
    );
    for (const worker of workers) {
      const { sessionId } = await this.cdp.send("Target.attachToTarget", {
        targetId: worker.targetId,
        flatten: true,
      });
      const { result } = await this.cdp.send(
        "Runtime.evaluate",
        { expression: "chrome.runtime.getManifest().name", returnByValue: true },
        sessionId,
      );
      await this.cdp.send("Target.detachFromTarget", { sessionId });
      if (result.value === "Window Mirror Sync") return { id: worker.targetId, url: worker.url };
    }
    return undefined;
  }

  /**
   * Opens a tab, in a new window or in the last window, sized and ready to navigate.
   * @param {{ newWindow?: boolean; size: { width: number; height: number } }} options
   */
  async newPage({ newWindow = true, size }) {
    // A size can only be given to a new window; tabs share their window's size.
    const { targetId } = await this.cdp.send("Target.createTarget", {
      url: "about:blank",
      newWindow,
      ...(newWindow ? { width: size.width, height: size.height } : {}),
    });
    const { sessionId } = await this.cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this.cdp, targetId, sessionId, this.config);
    await page.init(size);
    this.pages.push(page);
    return page;
  }

  /** Closes every page opened so far (between scenarios). */
  async closePages() {
    for (const page of this.pages.splice(0)) {
      await this.cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
    }
  }

  async close() {
    await this.cdp.send("Browser.close").catch(() => {});
    this.cdp.close();
    await Promise.race([new Promise((r) => this.proc.once("exit", r)), sleep(5000)]);
    if (this.proc.exitCode === null) this.proc.kill();
    await sleep(500);
    await rm(this.profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  }
}
