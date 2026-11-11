import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import { isTargetUrl } from "./targets";

export interface BroadcastMessage {
  action: string;
  type: string;
  [key: string]: unknown;
}

export type DeliveryStatus = "delivered" | "unreachable";

export interface DeliveryResult {
  tabId: number;
  status: DeliveryStatus;
}

interface TabState {
  /** Set once we tried injecting the content script into the current page. */
  injectAttempted: boolean;
}

/**
 * Fans broadcasts out to the other mirrored tabs.
 *
 * Target tabs are cached and kept current from tab events, so a broadcast (up to one per
 * animation frame for the ghost cursor) costs no `tabs.query`. When a tab has no content
 * script, injection is attempted at most once per page load, and never for cursor moves.
 */
export function createRouter() {
  const tabs: Map<number, TabState> = new Map();

  function track(tabId: number | undefined, url: string | undefined) {
    if (tabId === undefined) return;
    if (isTargetUrl(url)) tabs.set(tabId, { injectAttempted: false });
    else tabs.delete(tabId);
  }

  const ready = chrome.tabs.query({}).then(
    (list) => list.forEach((tab) => track(tab.id, tab.url)),
    (err) => console.warn("[BACKGROUND] Could not list tabs.", err),
  );

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    // A new URL or a reload starts a fresh page: re-check the URL and reset the back-off.
    if (info.url !== undefined || info.status === "loading") track(tabId, tab.url);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabs.delete(tabId);
  });
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    tabs.delete(removedTabId);
    chrome.tabs.get(addedTabId).then(
      (tab) => track(tab.id, tab.url),
      () => {},
    );
  });

  async function deliver(
    tabId: number,
    message: BroadcastMessage,
    options: chrome.tabs.MessageSendOptions,
    allowInject: boolean,
  ): Promise<DeliveryStatus> {
    try {
      await chrome.tabs.sendMessage(tabId, message, options);
      return "delivered";
    } catch {
      const state = tabs.get(tabId);
      if (!allowInject || !state || state.injectAttempted) return "unreachable";
      state.injectAttempted = true;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      });
    } catch (err) {
      console.warn(`[BACKGROUND] Could not inject into tab ${tabId} until it reloads.`, err);
      return "unreachable";
    }

    try {
      await chrome.tabs.sendMessage(tabId, message, options);
      return "delivered";
    } catch {
      return "unreachable";
    }
  }

  async function fanOut(
    message: BroadcastMessage,
    sender: chrome.runtime.MessageSender,
  ): Promise<DeliveryResult[]> {
    await ready;

    // Top-frame messages only concern top frames, so skip delivering them to iframes.
    // Iframe messages reach every frame; receivers match them by `framePath`.
    const options: chrome.tabs.MessageSendOptions = sender.frameId === 0 ? { frameId: 0 } : {};
    const execute = { ...message, action: ACTIONS.EXECUTE };
    const allowInject = message.type !== MESSAGE_TYPES.POINTER_MOVE;
    const targets = [...tabs.keys()].filter((tabId) => tabId !== sender.tab?.id);

    return Promise.all(
      targets.map(async (tabId) => ({
        tabId,
        status: await deliver(tabId, execute, options, allowInject),
      })),
    );
  }

  return { ready, fanOut, isTracked: (tabId: number) => tabs.has(tabId) };
}
