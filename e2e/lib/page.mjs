import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns console arguments into one line, dropping `%c` styling like DevTools does. */
function consoleLine(args) {
  const parts = args.map((arg) =>
    arg.value !== undefined ? String(arg.value) : (arg.description ?? ""),
  );
  if (typeof parts[0] === "string" && parts[0].includes("%c")) {
    const styles = (parts[0].match(/%c/g) ?? []).length;
    return [parts[0].replaceAll("%c", ""), ...parts.slice(1 + styles)].join(" ");
  }
  return parts.join(" ");
}

/** One tab, over its own DevTools session. */
export class Page {
  constructor(cdp, targetId, sessionId, config) {
    this.cdp = cdp;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.config = config;
    /** Console lines from the page and from the extension's content script. */
    this.logs = [];
    /** Uncaught page errors. */
    this.errors = [];
    /** The content script's isolated world in the top frame (its execution context id). */
    this.extensionContext = undefined;
    this.size = config.size;

    cdp.onEvent(({ method, params, sessionId: from }) => {
      if (from !== sessionId) return;
      if (method === "Runtime.consoleAPICalled") this.logs.push(consoleLine(params.args));
      if (method === "Runtime.executionContextCreated") {
        const { id, name, auxData } = params.context;
        if (
          auxData?.type === "isolated" &&
          auxData.isDefault === false &&
          name === "Window Mirror Sync"
        ) {
          if (auxData.frameId === this.targetId) this.extensionContext = id;
        }
      }
      if (method === "Runtime.executionContextsCleared") this.extensionContext = undefined;
      if (method === "Runtime.exceptionThrown") {
        this.errors.push(
          params.exceptionDetails.exception?.description ?? params.exceptionDetails.text,
        );
      }
    });
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async init(size) {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.resize(size);
  }

  /** Sets the viewport (what the page sees as innerWidth x innerHeight). */
  async resize({ width, height }) {
    this.size = { width, height };
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  /**
   * Makes this the tab the user works in: it reports focus (`document.hasFocus()`), like the
   * window in front. Only one page should have it.
   */
  async focus() {
    await this.send("Page.bringToFront");
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("document.readyState === 'complete'", { what: `load of ${url}` });
  }

  /** Evaluates `expression` in the page (main world) and returns the value. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(
        `Evaluation failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
      );
    }
    return result.value;
  }

  /** Evaluates `expression` in the extension's content-script world (top frame). */
  async evaluateInExtension(expression) {
    await this.waitFor("true", { what: "the page" });
    const end = Date.now() + this.config.timeout;
    while (this.extensionContext === undefined) {
      if (Date.now() > end) throw new Error("The content script's world never appeared");
      await sleep(100);
    }
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      contextId: this.extensionContext,
      returnByValue: true,
    });
    if (exceptionDetails)
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  /**
   * Pins what the extension sees from `document.hasFocus()` in this tab. Headless browsers
   * report every window as focused, unlike a desktop with one window in front, so scenarios
   * set it per tab: true for the sender, false for the others. Only the content script's
   * world is affected, not the page.
   */
  async setExtensionFocus(focused) {
    await this.evaluateInExtension(
      `Object.defineProperty(document, "hasFocus", { configurable: true, value: () => ${focused} }), true`,
    );
  }

  /** Polls `expression` until it's truthy; returns its value. */
  async waitFor(expression, { timeout = this.config.timeout, what = expression } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      const value = await this.evaluate(expression).catch(() => undefined);
      if (value) return value;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await sleep(200);
    }
  }

  /** Waits for a console line matching `pattern` (string or RegExp), from index `since`. */
  async waitForLog(pattern, { since = 0, timeout = this.config.timeout } = {}) {
    const end = Date.now() + timeout;
    const test = (line) =>
      typeof pattern === "string" ? line.includes(pattern) : pattern.test(line);
    for (;;) {
      const line = this.logs.slice(since).find(test);
      if (line) return line;
      if (Date.now() > end) throw new Error(`Timed out waiting for a log matching ${pattern}`);
      await sleep(100);
    }
  }

  /** Lines logged since index `since` that match `pattern`. */
  logsSince(since, pattern) {
    return this.logs.slice(since).filter((line) => line.includes(pattern));
  }

  /** The centre of the first visible element matching `selector`, in viewport px. */
  async centerOf(selector) {
    return this.evaluate(`(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 &&
          r.left < innerWidth && r.top < innerHeight;
      };
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(visible);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  }

  /** The centre of the innermost visible element whose text is exactly `text`. */
  async centerOfText(text) {
    return this.evaluate(`(() => {
      const matches = [...document.querySelectorAll("body *")].filter((el) => {
        const r = el.getBoundingClientRect();
        return (el.innerText || "").trim() === ${JSON.stringify(text)} && r.width > 0 && r.height > 0;
      });
      const el = matches.find((el) => !matches.some((other) => other !== el && el.contains(other)));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  }

  /** A real (trusted) left click at a viewport point. */
  async click({ x, y }) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  }

  /** A real (trusted) mouse drag from one viewport point to another, in `steps` moves. */
  async drag(from, to, steps = 8) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...from,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "left",
        buttons: 1,
      });
    }
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...to,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  }

  /** The extension panel's box, and the centre of its drag handle, in viewport px. */
  async panelBox() {
    return this.evaluate(`(() => {
      const host = document.getElementById("mirror-sync-panel");
      const handle = host?.shadowRoot?.querySelector(".drag-handle");
      if (!host || !handle) return null;
      const r = host.getBoundingClientRect();
      const h = handle.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height,
        handle: { x: h.left + h.width / 2, y: h.top + h.height / 2 } };
    })()`);
  }

  /** Real (trusted) text input into the focused element. */
  async type(text) {
    await this.send("Input.insertText", { text });
  }

  /** Flips one of the extension panel's switches (top frame only). */
  async setSwitch(idPrefix, on) {
    await this.evaluate(`(() => {
      const input = document.getElementById("mirror-sync-panel")
        ?.shadowRoot?.querySelector('[id^="${idPrefix}"]');
      if (!input) throw new Error("No panel switch ${idPrefix}");
      if (input.checked !== ${on}) input.click();
    })()`);
  }

  /**
   * Moves the extension panel out of the way (it starts top-right, where pages often have
   * controls of their own). Like dragging it there by its handle.
   */
  async movePanel({ left, top }) {
    await this.evaluate(`(() => {
      const host = document.getElementById("mirror-sync-panel");
      if (!host) return;
      host.style.left = "${left}px";
      host.style.top = "${top}px";
      host.style.right = "auto";
    })()`);
  }

  async screenshot(dir, name) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${name}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  }
}
