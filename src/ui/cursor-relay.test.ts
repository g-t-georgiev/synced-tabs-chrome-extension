import { describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS } from "../shared/constants";
import { installChromeMock } from "../test/chrome-mock";
import { createRelayCursor, listenForCursorRelays } from "./cursor-relay";

// Tests run in a top-level window, whose frame path is "".
const relay = (fromPath: string, x = 10, y = 20) => ({
  action: ACTIONS.CURSOR_RELAY,
  fromPath,
  x,
  y,
});

describe("cursor relay", () => {
  it("a relay cursor hands its point to the worker with its own frame path", () => {
    const chrome = installChromeMock();

    createRelayCursor().moveTo(10, 20);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith(relay(""));
  });

  it("a relay cursor stays quiet once the extension context is gone", () => {
    const chrome = installChromeMock();
    chrome.runtime.sendMessage.mockImplementation(() => {
      throw new Error("Extension context invalidated.");
    });

    expect(() => createRelayCursor().moveTo(1, 1)).not.toThrow();
  });

  it("a parent shifts a direct child's point by that child's position", () => {
    const chrome = installChromeMock();
    const cursor = { moveTo: vi.fn() };
    const offsetOfChild = vi.fn((index: number) => (index === 1 ? { x: 100, y: 50 } : null));
    listenForCursorRelays(cursor, offsetOfChild);

    chrome.runtime.onMessage.fire(relay("1", 10, 20));

    expect(offsetOfChild).toHaveBeenCalledWith(1);
    expect(cursor.moveTo).toHaveBeenCalledExactlyOnceWith(110, 70);
  });

  it("ignores points from frames that aren't its direct children", () => {
    const chrome = installChromeMock();
    const cursor = { moveTo: vi.fn() };
    listenForCursorRelays(cursor, () => ({ x: 0, y: 0 }));

    chrome.runtime.onMessage.fire(relay("1/0")); // a grandchild: its parent "1" handles it
    chrome.runtime.onMessage.fire(relay("")); // the top frame itself
    chrome.runtime.onMessage.fire({ action: ACTIONS.EXECUTE, fromPath: "1", x: 0, y: 0 });
    chrome.runtime.onMessage.fire({ action: ACTIONS.CURSOR_RELAY, fromPath: "1" }); // no point

    expect(cursor.moveTo).not.toHaveBeenCalled();
  });

  it("drops a point when the child's iframe can't be found", () => {
    const chrome = installChromeMock();
    const cursor = { moveTo: vi.fn() };
    listenForCursorRelays(cursor, () => null);

    chrome.runtime.onMessage.fire(relay("0"));

    expect(cursor.moveTo).not.toHaveBeenCalled();
  });

  it("stops listening when unsubscribed", () => {
    const chrome = installChromeMock();
    const cursor = { moveTo: vi.fn() };
    const stop = listenForCursorRelays(cursor, () => ({ x: 0, y: 0 }));

    stop();
    chrome.runtime.onMessage.fire(relay("0"));

    expect(cursor.moveTo).not.toHaveBeenCalled();
  });
});
