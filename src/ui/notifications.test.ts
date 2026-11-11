import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS } from "../shared/constants";
import { OWN_UI_ATTR } from "../dom";
import { installChromeMock } from "../test/chrome-mock";
import { createNotifier, createRelayNotifier, listenForRelayedNotices } from "./notifications";

function host() {
  return document.querySelector<HTMLElement>(`[${OWN_UI_ATTR}]`)!;
}

function toasts() {
  return [...host().shadowRoot!.querySelectorAll<HTMLElement>(".toast")].map((toast) => ({
    level: toast.classList.contains("error") ? "error" : "warning",
    text: toast.firstElementChild!.textContent,
    count: toast.lastElementChild!.textContent,
  }));
}

describe("createNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("renders warnings and errors in a host marked as the extension's own UI", () => {
    const notifier = createNotifier();

    notifier.warn("Size mismatch");
    notifier.error("Could not reach tab");

    expect(host().hasAttribute(OWN_UI_ATTR)).toBe(true);
    expect(toasts()).toEqual([
      { level: "warning", text: "Size mismatch", count: "" },
      { level: "error", text: "Could not reach tab", count: "" },
    ]);
  });

  it("treats text as text, never as HTML", () => {
    createNotifier().warn("<img src=x onerror=alert(1)>");

    expect(host().shadowRoot!.querySelector("img")).toBeNull();
    expect(toasts()[0]!.text).toBe("<img src=x onerror=alert(1)>");
  });

  it("refreshes a repeated notice with a count instead of stacking copies", () => {
    const notifier = createNotifier();

    notifier.warn("Size mismatch");
    notifier.warn("Size mismatch");
    notifier.warn("Size mismatch");

    expect(toasts()).toEqual([{ level: "warning", text: "Size mismatch", count: "×3" }]);
  });

  it("updates the text of a keyed notice in place", () => {
    const notifier = createNotifier();

    notifier.warn("1 tab differs", { key: "mismatch" });
    notifier.warn("2 tabs differ", { key: "mismatch" });

    expect(toasts()).toEqual([{ level: "warning", text: "2 tabs differ", count: "×2" }]);
  });

  it("dismisses after its duration, counted from the latest refresh", () => {
    const notifier = createNotifier();

    notifier.warn("Size mismatch", { durationMs: 1000 });
    vi.advanceTimersByTime(800);
    notifier.warn("Size mismatch", { durationMs: 1000 });
    vi.advanceTimersByTime(800);
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(200);
    expect(toasts()).toHaveLength(0);
  });

  it("dismisses on click", () => {
    createNotifier().error("Could not reach tab");

    host().shadowRoot!.querySelector<HTMLElement>(".toast")!.click();

    expect(toasts()).toHaveLength(0);
  });

  it("keeps at most four toasts, dropping the oldest", () => {
    const notifier = createNotifier();

    for (const n of [1, 2, 3, 4, 5]) notifier.warn(`notice ${n}`);

    expect(toasts().map((toast) => toast.text)).toEqual([
      "notice 2",
      "notice 3",
      "notice 4",
      "notice 5",
    ]);
  });

  it("moves a refreshed notice to the newest position", () => {
    const notifier = createNotifier();

    notifier.warn("a");
    notifier.warn("b");
    notifier.warn("a");

    expect(toasts().map((toast) => toast.text)).toEqual(["b", "a"]);
  });
});

describe("relayed notices", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("child frames send notices to the worker", () => {
    const chrome = installChromeMock();

    createRelayNotifier().error("Could not reach tab", { key: "k" });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: ACTIONS.NOTIFY,
      level: "error",
      text: "Could not reach tab",
      options: { key: "k" },
    });
  });

  it("child frames stay quiet when the extension context is gone", () => {
    const chrome = installChromeMock();
    chrome.runtime.sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });

    expect(() => createRelayNotifier().warn("x")).not.toThrow();
  });

  it("the top frame shows relayed notices and ignores other messages", () => {
    const chrome = installChromeMock();
    const notifier = { warn: vi.fn(), error: vi.fn() };
    const stop = listenForRelayedNotices(notifier);

    chrome.runtime.onMessage.fire({ action: ACTIONS.NOTIFY, level: "warning", text: "w" });
    chrome.runtime.onMessage.fire({ action: ACTIONS.NOTIFY, level: "error", text: "e" });
    chrome.runtime.onMessage.fire({ action: ACTIONS.EXECUTE, text: "not a notice" });
    chrome.runtime.onMessage.fire({ action: ACTIONS.NOTIFY, level: "error" });
    stop();
    chrome.runtime.onMessage.fire({ action: ACTIONS.NOTIFY, level: "error", text: "late" });

    expect(notifier.warn).toHaveBeenCalledExactlyOnceWith("w", undefined);
    expect(notifier.error).toHaveBeenCalledExactlyOnceWith("e", undefined);
  });
});
