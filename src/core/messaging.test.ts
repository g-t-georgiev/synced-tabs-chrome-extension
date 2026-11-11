import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS } from "../shared/constants";
import { installChromeMock } from "../test/chrome-mock";
import { CONTEXT_LOST_NOTICE, createTransport } from "./messaging";

function stubNotifier() {
  return { warn: vi.fn(), error: vi.fn() };
}

const INVALIDATED = new Error("Extension context invalidated.");

describe("createTransport: lost extension context", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows an error toast when sending throws because the extension was reloaded", () => {
    const chrome = installChromeMock();
    chrome.runtime.sendMessage.mockImplementation(() => {
      throw INVALIDATED;
    });
    const notifier = stubNotifier();

    createTransport({ windowId: "me", notifier }).broadcast({});

    expect(notifier.error).toHaveBeenCalledExactlyOnceWith(CONTEXT_LOST_NOTICE, {
      key: "context-lost",
      durationMs: 10_000,
    });
  });

  it("shows it when the send is rejected for the same reason", async () => {
    const chrome = installChromeMock();
    chrome.runtime.sendMessage.mockRejectedValue(INVALIDATED);
    const notifier = stubNotifier();

    createTransport({ windowId: "me", notifier }).broadcast({});
    await vi.waitFor(() => expect(notifier.error).toHaveBeenCalledOnce());
  });

  it("does not send at all once runtime.id is gone", () => {
    const chrome = installChromeMock();
    chrome.runtime.id = undefined;
    const notifier = stubNotifier();

    createTransport({ windowId: "me", notifier }).broadcast({});

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(notifier.error).toHaveBeenCalledOnce();
  });

  it("repeats the toast at most every 30 seconds", () => {
    vi.useFakeTimers();
    const chrome = installChromeMock();
    chrome.runtime.id = undefined;
    const notifier = stubNotifier();
    const transport = createTransport({ windowId: "me", notifier });

    for (let i = 0; i < 100; i++) transport.broadcast({}); // e.g. cursor frames
    expect(notifier.error).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(30_000);
    transport.broadcast({});
    expect(notifier.error).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for other send failures", async () => {
    const chrome = installChromeMock();
    chrome.runtime.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));
    const notifier = stubNotifier();

    createTransport({ windowId: "me", notifier }).broadcast({});
    await Promise.resolve();
    await Promise.resolve();

    expect(notifier.error).not.toHaveBeenCalled();
  });
});

describe("createTransport: delivery reports", () => {
  const base = { action: ACTIONS.EXECUTE, originWindowId: "other", framePath: "" };
  const dropped = {
    status: "dropped",
    reason: "viewport-mismatch",
    viewport: { w: 1280, h: 577 },
  } as const;

  it("asks for a report only when requested, and shows its drops as toasts", async () => {
    const chrome = installChromeMock();
    chrome.runtime.sendMessage.mockResolvedValue({
      results: [{ tabId: 2, status: "delivered", result: dropped }],
    });
    const notifier = stubNotifier();
    const transport = createTransport({ windowId: "me", notifier });

    transport.broadcast({ type: "POINTER_EVENT" });
    transport.broadcast({ type: "POINTER_EVENT" }, { report: "Clicks" });

    expect(chrome.runtime.sendMessage.mock.calls[0]![0]).not.toHaveProperty("report");
    expect(chrome.runtime.sendMessage.mock.calls[1]![0]).toMatchObject({ report: true });
    await vi.waitFor(() =>
      expect(notifier.warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("Clicks were not mirrored to 1 tab"),
        { key: "viewport-mismatch:Clicks" },
      ),
    );
  });

  it("answers a remote message with the handler's result", () => {
    const chrome = installChromeMock();
    createTransport({ windowId: "me", notifier: stubNotifier() }).onRemote(() => dropped);
    const sendResponse = vi.fn();

    chrome.runtime.onMessage.fire(base, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledExactlyOnceWith(dropped);
  });

  it("answers later when the handler's result is still pending", async () => {
    const chrome = installChromeMock();
    let settle!: (value: typeof dropped) => void;
    createTransport({ windowId: "me", notifier: stubNotifier() }).onRemote(
      () => new Promise((resolve) => (settle = resolve)),
    );
    const sendResponse = vi.fn();

    chrome.runtime.onMessage.fire(base, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();

    settle(dropped);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledExactlyOnceWith(dropped));
  });

  it("keeps the channel open for a pending answer, and only then", () => {
    const chrome = installChromeMock();
    const transport = createTransport({ windowId: "me", notifier: stubNotifier() });

    transport.onRemote(() => dropped);
    transport.onRemote(() => new Promise(() => {}));
    const [immediate, pending] = chrome.runtime.onMessage.addListener.mock.calls.map(
      ([listener]) => listener,
    );

    expect(immediate!(base, {}, vi.fn())).toBeUndefined();
    expect(pending!(base, {}, vi.fn())).toBe(true);
  });

  it("frames at a different position stay silent, leaving the answer to the matching frame", () => {
    const chrome = installChromeMock();
    createTransport({ windowId: "me", notifier: stubNotifier() }).onRemote(() => dropped);
    const sendResponse = vi.fn();

    chrome.runtime.onMessage.fire({ ...base, framePath: "0" }, {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe("createTransport", () => {
  it("broadcast tags the payload with action, window id and frame path", () => {
    const chrome = installChromeMock();
    const transport = createTransport({ windowId: "me", notifier: stubNotifier() });

    transport.broadcast({ type: "KEY_EVENT" });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "KEY_EVENT",
      action: ACTIONS.BROADCAST,
      originWindowId: "me",
      framePath: "",
      viewport: { w: window.innerWidth, h: window.innerHeight },
    });
  });

  it("broadcast swallows rejected sends", async () => {
    const chrome = installChromeMock();
    chrome.runtime.sendMessage.mockRejectedValueOnce(new Error("no receiver"));

    expect(() =>
      createTransport({ windowId: "me", notifier: stubNotifier() }).broadcast({}),
    ).not.toThrow();
    await Promise.resolve();
  });

  it("onRemote delivers only execute messages from other windows in the same frame", () => {
    const chrome = installChromeMock();
    const handler = vi.fn();
    createTransport({ windowId: "me", notifier: stubNotifier() }).onRemote(handler);
    const base = { action: ACTIONS.EXECUTE, originWindowId: "other", framePath: "" };

    chrome.runtime.onMessage.fire({ ...base, action: ACTIONS.BROADCAST });
    chrome.runtime.onMessage.fire({ ...base, originWindowId: "me" });
    chrome.runtime.onMessage.fire({ ...base, framePath: "0" });
    expect(handler).not.toHaveBeenCalled();

    chrome.runtime.onMessage.fire(base);
    expect(handler).toHaveBeenCalledExactlyOnceWith(base);
  });

  it("onRemote returns an unsubscribe function", () => {
    const chrome = installChromeMock();
    const handler = vi.fn();
    const unsubscribe = createTransport({ windowId: "me", notifier: stubNotifier() }).onRemote(
      handler,
    );

    unsubscribe();
    chrome.runtime.onMessage.fire({
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
    });

    expect(handler).not.toHaveBeenCalled();
    expect(chrome.runtime.onMessage.hasListeners()).toBe(false);
  });
});
