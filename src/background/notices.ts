import type { NoticeMessage } from "../shared/types";

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
