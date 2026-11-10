import { describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS } from "../shared/constants";
import { installChromeMock } from "../test/chrome-mock";
import { createTransport } from "./messaging";

describe("createTransport", () => {
  it("broadcast tags the payload with action, window id and frame path", () => {
    const chrome = installChromeMock();
    const transport = createTransport({ windowId: "me" });

    transport.broadcast({ type: "KEY_EVENT" });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "KEY_EVENT",
      action: ACTIONS.BROADCAST,
      originWindowId: "me",
      framePath: "",
    });
  });

  it("broadcast swallows rejected sends", async () => {
    const chrome = installChromeMock();
    chrome.runtime.sendMessage.mockRejectedValueOnce(new Error("no receiver"));

    expect(() => createTransport({ windowId: "me" }).broadcast({})).not.toThrow();
    await Promise.resolve();
  });

  it("onRemote delivers only execute messages from other windows in the same frame", () => {
    const chrome = installChromeMock();
    const handler = vi.fn();
    createTransport({ windowId: "me" }).onRemote(handler);
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
    const unsubscribe = createTransport({ windowId: "me" }).onRemote(handler);

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
