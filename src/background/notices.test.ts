import { describe, expect, it } from "vite-plus/test";
import { ACTIONS } from "../shared/constants";
import type { NoticeMessage } from "../shared/types";
import { installChromeMock } from "../test/chrome-mock";
import { relayNotice } from "./notices";

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
