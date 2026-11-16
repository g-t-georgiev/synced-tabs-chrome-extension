import { describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import { installChromeMock } from "../test/chrome-mock";
import { createRouter } from "./router";

const TABS = [
  { id: 1, url: "http://localhost:8080/" },
  { id: 2, url: "https://frontend-dev.octoplay.dev/game/" },
  { id: 3, url: "http://localhost:8081/" },
  { id: 4, url: "https://example.com/?next=localhost" },
  { id: 5, url: "chrome://extensions/" },
];

const click = { action: ACTIONS.BROADCAST, type: MESSAGE_TYPES.POINTER_EVENT, subType: "click" };
const move = { action: ACTIONS.BROADCAST, type: MESSAGE_TYPES.POINTER_MOVE };
const fromTab = (id: number, frameId = 0) => ({ tab: { id } as chrome.tabs.Tab, frameId });

async function setup(tabs = TABS) {
  const chrome = installChromeMock({}, tabs);
  const router = createRouter();
  await router.ready;
  return { chrome, router };
}

/** Makes `sendMessage` fail for the given tabs, as when no content script is listening. */
function noReceiver(chrome: ReturnType<typeof installChromeMock>, ...tabIds: number[]) {
  chrome.tabs.sendMessage.mockImplementation(async (tabId: number) => {
    if (tabIds.includes(tabId)) throw new Error("Receiving end does not exist.");
    return undefined;
  });
}

describe("createRouter", () => {
  it("delivers to every other target tab, never by URL substring", async () => {
    const { chrome, router } = await setup();

    const results = await router.fanOut(click, fromTab(1));

    expect(results).toEqual([
      { tabId: 2, status: "delivered" },
      { tabId: 3, status: "delivered" },
    ]);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      2,
      { ...click, action: ACTIONS.EXECUTE },
      { frameId: 0 },
    );
    expect(router.isTracked(4)).toBe(false);
    expect(router.isTracked(5)).toBe(false);
  });

  it("sends iframe messages to all frames of the target tabs", async () => {
    const { chrome, router } = await setup();

    await router.fanOut(click, fromTab(1, 7));

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, expect.anything(), {});
  });

  it("does not query tabs or log per broadcast", async () => {
    const { chrome, router } = await setup();
    const log = vi.spyOn(console, "log");

    await router.fanOut(move, fromTab(1));
    await router.fanOut(move, fromTab(1));

    expect(chrome.tabs.query).toHaveBeenCalledOnce(); // only at startup
    expect(log).not.toHaveBeenCalled();
  });

  it("follows tabs navigating to and away from target URLs", async () => {
    const { chrome, router } = await setup();

    chrome.tabs.onUpdated.fire(4, { url: "http://localhost:8082/" } as chrome.tabs.OnUpdatedInfo, {
      id: 4,
      url: "http://localhost:8082/",
    });
    chrome.tabs.onUpdated.fire(2, { url: "https://example.com/" } as chrome.tabs.OnUpdatedInfo, {
      id: 2,
      url: "https://example.com/",
    });

    expect(router.isTracked(4)).toBe(true);
    expect(router.isTracked(2)).toBe(false);
  });

  it("forgets closed and replaced tabs, and picks up their replacements", async () => {
    const tabs = [...TABS, { id: 9, url: "http://localhost:8080/" }];
    const { chrome, router } = await setup(tabs);

    chrome.tabs.onRemoved.fire(3);
    chrome.tabs.onReplaced.fire(9, 1);
    await vi.waitFor(() => expect(router.isTracked(9)).toBe(true));

    expect(router.isTracked(3)).toBe(false);
    expect(router.isTracked(1)).toBe(false);
  });

  it("injects into a tab without a content script once, then retries delivery", async () => {
    const { chrome, router } = await setup();
    let injected = false;
    chrome.scripting.executeScript.mockImplementation(async () => {
      injected = true;
      return [];
    });
    chrome.tabs.sendMessage.mockImplementation(async (tabId: number) => {
      if (tabId === 3 && !injected) throw new Error("Receiving end does not exist.");
      return undefined;
    });

    const results = await router.fanOut(click, fromTab(1));

    expect(results).toContainEqual({ tabId: 3, status: "delivered" });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 3, allFrames: true },
      files: ["content.js"],
    });
  });

  it("tries injecting at most once per page load", async () => {
    const { chrome, router } = await setup();
    noReceiver(chrome, 3);
    chrome.scripting.executeScript.mockRejectedValue(new Error("Cannot access contents"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await router.fanOut(click, fromTab(1));
    const results = await router.fanOut(click, fromTab(1));

    expect(results).toContainEqual({ tabId: 3, status: "unreachable" });
    expect(chrome.scripting.executeScript).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledOnce();

    // A reload starts a new page, so one more attempt is allowed.
    chrome.tabs.onUpdated.fire(3, { status: "loading" } as chrome.tabs.OnUpdatedInfo, TABS[2]);
    await router.fanOut(click, fromTab(1));

    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  });

  it("includes each receiver's answer, ignoring malformed ones", async () => {
    const { chrome, router } = await setup();
    const dropped = { status: "dropped", reason: "viewport-mismatch", viewport: { w: 1, h: 1 } };
    chrome.tabs.sendMessage.mockImplementation(async (tabId: number) =>
      tabId === 2 ? dropped : { status: "whatever" },
    );

    const results = await router.fanOut({ ...click, report: true }, fromTab(1));

    expect(results).toEqual([
      { tabId: 2, status: "delivered", result: dropped },
      { tabId: 3, status: "delivered" },
    ]);
  });

  it("never injects for cursor moves", async () => {
    const { chrome, router } = await setup();
    noReceiver(chrome, 3);

    const results = await router.fanOut(move, fromTab(1));

    expect(results).toContainEqual({ tabId: 3, status: "unreachable" });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe("createRouter: Same Window Only", () => {
  // Window 1: a split view of tabs 1 and 2. Window 2: tab 3 on the other monitor.
  const WINDOWED_TABS = [
    { id: 1, windowId: 1, url: "http://localhost:8080/" },
    { id: 2, windowId: 1, url: "https://frontend-dev.octoplay.dev/game/" },
    { id: 3, windowId: 2, url: "http://localhost:8081/" },
  ];
  const fromTabInWindow = (id: number, windowId: number) => ({
    tab: { id, windowId } as chrome.tabs.Tab,
    frameId: 0,
  });

  it("reaches every window by default", async () => {
    const { router } = await setup(WINDOWED_TABS);

    const results = await router.fanOut(click, fromTabInWindow(1, 1));

    expect(results.map(({ tabId }) => tabId)).toEqual([2, 3]);
  });

  it("reaches only the sender's window with scope 'window'", async () => {
    const { router } = await setup(WINDOWED_TABS);

    const results = await router.fanOut({ ...click, scope: "window" }, fromTabInWindow(1, 1));

    expect(results.map(({ tabId }) => tabId)).toEqual([2]);
  });

  it("follows a tab dragged into another window", async () => {
    const { chrome, router } = await setup(WINDOWED_TABS);

    chrome.tabs.onAttached.fire(3, { newWindowId: 1, newPosition: 2 });
    const results = await router.fanOut({ ...click, scope: "window" }, fromTabInWindow(1, 1));

    expect(results.map(({ tabId }) => tabId)).toEqual([2, 3]);
  });

  it("picks up the window of a tab that navigates to a target page", async () => {
    const { chrome, router } = await setup(WINDOWED_TABS);

    chrome.tabs.onUpdated.fire(9, { url: "http://localhost:8082/" } as chrome.tabs.OnUpdatedInfo, {
      id: 9,
      windowId: 1,
      url: "http://localhost:8082/",
    });
    const results = await router.fanOut({ ...click, scope: "window" }, fromTabInWindow(1, 1));

    expect(results.map(({ tabId }) => tabId)).toEqual([2, 9]);
  });
});
