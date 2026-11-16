import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { ApplyResult, TabDelivery } from "../shared/types";
import { isTargetUrl } from "./targets";

export interface BroadcastMessage {
  action: string;
  type: string;
  /** The sender wants every receiver's answer back (see `DeliveryReport`). */
  report?: boolean;
  /** "window": deliver only to tabs in the sender's window ("Same Window Only"). */
  scope?: "window";
  [key: string]: unknown;
}

type Delivery = Omit<TabDelivery, "tabId">;

const UNREACHABLE: Delivery = { status: "unreachable" };

/** A receiver's answer, if it is a well-formed `ApplyResult`. */
function asApplyResult(answer: unknown): ApplyResult | undefined {
  const status = (answer as Partial<ApplyResult> | undefined)?.status;
  return status === "applied" || status === "dropped" ? (answer as ApplyResult) : undefined;
}

function delivered(answer: unknown): Delivery {
  const result = asApplyResult(answer);
  return result ? { status: "delivered", result } : { status: "delivered" };
}

interface TabState {
  /** Set once we tried injecting the content script into the current page. */
  injectAttempted: boolean;
  /** The window the tab is in, for "Same Window Only". */
  windowId: number | undefined;
}

/**
 * Fans broadcasts out to the other mirrored tabs.
 *
 * Target tabs are cached and kept current from tab events, so a broadcast (up to one per
 * animation frame for the ghost cursor) costs no `tabs.query`. When a tab has no content
 * script, injection is attempted at most once per page load, and never for cursor moves.
 */
export function createRouter({
  isTarget = isTargetUrl,
}: {
  /** Which tab URLs take part (defaults to the build's `VITE_TARGET_MATCHES`). */
  isTarget?: (url: string | undefined) => boolean;
} = {}) {
  const tabs: Map<number, TabState> = new Map();

  function track(tab: Pick<chrome.tabs.Tab, "id" | "url" | "windowId">) {
    if (tab.id === undefined) return;
    if (isTarget(tab.url)) tabs.set(tab.id, { injectAttempted: false, windowId: tab.windowId });
    else tabs.delete(tab.id);
  }

  const ready = chrome.tabs.query({}).then(
    (list) => list.forEach(track),
    (err) => console.warn("[BACKGROUND] Could not list tabs.", err),
  );

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    // A new URL or a reload starts a fresh page: re-check the URL and reset the back-off.
    if (info.url !== undefined || info.status === "loading") track({ ...tab, id: tabId });
  });
  // A tab dragged into another window (or out into a new one) changes its window.
  chrome.tabs.onAttached.addListener((tabId, { newWindowId }) => {
    const state = tabs.get(tabId);
    if (state) state.windowId = newWindowId;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabs.delete(tabId);
  });
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    tabs.delete(removedTabId);
    chrome.tabs.get(addedTabId).then(track, () => {});
  });

  async function deliver(
    tabId: number,
    message: BroadcastMessage,
    options: chrome.tabs.MessageSendOptions,
    allowInject: boolean,
  ): Promise<Delivery> {
    try {
      return delivered(await chrome.tabs.sendMessage(tabId, message, options));
    } catch {
      const state = tabs.get(tabId);
      if (!allowInject || !state || state.injectAttempted) return UNREACHABLE;
      state.injectAttempted = true;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      });
    } catch (err) {
      console.warn(`[BACKGROUND] Could not inject into tab ${tabId} until it reloads.`, err);
      return UNREACHABLE;
    }

    try {
      return delivered(await chrome.tabs.sendMessage(tabId, message, options));
    } catch {
      return UNREACHABLE;
    }
  }

  async function fanOut(
    message: BroadcastMessage,
    sender: chrome.runtime.MessageSender,
  ): Promise<TabDelivery[]> {
    await ready;

    // Top-frame messages only concern top frames, so skip delivering them to iframes.
    // Iframe messages reach every frame; receivers match them by `framePath`.
    const options: chrome.tabs.MessageSendOptions = sender.frameId === 0 ? { frameId: 0 } : {};
    const execute = { ...message, action: ACTIONS.EXECUTE };
    const allowInject = message.type !== MESSAGE_TYPES.POINTER_MOVE;
    const sameWindow = message.scope === "window";
    const targets = [...tabs.entries()]
      .filter(([tabId]) => tabId !== sender.tab?.id)
      .filter(([, state]) => !sameWindow || state.windowId === sender.tab?.windowId)
      .map(([tabId]) => tabId);

    return Promise.all(
      targets.map(async (tabId) => ({
        tabId,
        ...(await deliver(tabId, execute, options, allowInject)),
      })),
    );
  }

  return { ready, fanOut, isTracked: (tabId: number) => tabs.has(tabId) };
}
