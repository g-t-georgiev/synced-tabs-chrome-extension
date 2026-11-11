import type { CursorRelayMessage, NoticeMessage } from "../shared/types";

/**
 * Forwards a ghost-cursor point from a child frame to every frame of its own tab; only the
 * sending frame's parent picks it up (by frame path). The worker can't target the parent
 * directly without the `webNavigation` permission, and a broadcast within one tab is cheap.
 */
export async function relayCursor(
  message: CursorRelayMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId === 0) return;

  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The tab is navigating or has no content script: drop this point.
  }
}

/**
 * Forwards a notice raised in a child frame to the top frame of the same tab, where the
 * toasts are rendered. Top-frame notices never come through here: they render locally.
 */
export async function relayNotice(
  message: NoticeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId === 0) return;

  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  } catch {
    // The top frame has no content script (or is navigating): drop the notice.
  }
}
