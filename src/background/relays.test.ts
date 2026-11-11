import { describe, expect, it } from "vite-plus/test";
import { ACTIONS } from "../shared/constants";
import type { NoticeMessage } from "../shared/types";
import { installChromeMock } from "../test/chrome-mock";
import { relayCursor, relayNotice } from "./relays";

const notice: NoticeMessage = { action: ACTIONS.NOTIFY, level: "warning", text: "w" };

describe("relayNotice", () => {
  it("forwards a child frame's notice to its own tab's top frame", async () => {
    const chrome = installChromeMock();

    await relayNotice(notice, { tab: { id: 7 } as chrome.tabs.Tab, frameId: 3 });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(7, notice, { frameId: 0 });
  });

  it("ignores top-frame and tab-less senders", async () => {
    const chrome = installChromeMock();

    await relayNotice(notice, { tab: { id: 7 } as chrome.tabs.Tab, frameId: 0 });
    await relayNotice(notice, { frameId: 3 });

    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("drops the notice when the top frame cannot receive it", async () => {
    const chrome = installChromeMock();
    chrome.tabs.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));

    await expect(
      relayNotice(notice, { tab: { id: 7 } as chrome.tabs.Tab, frameId: 3 }),
    ).resolves.toBeUndefined();
  });
});

describe("relayCursor", () => {
  const point = { action: ACTIONS.CURSOR_RELAY, fromPath: "1/0", x: 1, y: 2 };

  it("forwards a child frame's point to every frame of its own tab", async () => {
    const chrome = installChromeMock();

    await relayCursor(point, { tab: { id: 7 } as chrome.tabs.Tab, frameId: 4 });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(7, point);
  });

  it("ignores top-frame and tab-less senders, and swallows delivery errors", async () => {
    const chrome = installChromeMock();
    chrome.tabs.sendMessage.mockRejectedValue(new Error("Receiving end does not exist."));

    await relayCursor(point, { tab: { id: 7 } as chrome.tabs.Tab, frameId: 0 });
    await relayCursor(point, { frameId: 4 });
    await expect(
      relayCursor(point, { tab: { id: 7 } as chrome.tabs.Tab, frameId: 4 }),
    ).resolves.toBeUndefined();

    expect(chrome.tabs.sendMessage).toHaveBeenCalledOnce();
  });
});
