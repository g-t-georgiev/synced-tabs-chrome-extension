import type { MessageController, Notifier } from "../shared/types";
import { ACTIONS } from "../shared/constants";
import { getFramePath } from "./frame-path";

/** Shown when this content script outlives its extension (reloaded or updated). */
export const CONTEXT_LOST_NOTICE = "Mirror Sync was reloaded. Reload this tab to keep it in sync.";
/** Re-show the lost-context toast at most this often while the user keeps interacting. */
const CONTEXT_LOST_REPEAT_MS = 30_000;

function isContextInvalidated(err: unknown) {
  return err instanceof Error && /extension context invalidated/i.test(err.message);
}

export function createTransport({
  windowId,
  notifier,
}: {
  windowId: string;
  notifier: Notifier;
}): MessageController {
  let contextLostAt = -Infinity;

  /**
   * After the extension reloads, old content scripts stay in open tabs but can no longer
   * reach it, so mirroring silently stops. Tell the user once (and again only after a
   * while) instead of on every cursor frame.
   */
  function onContextLost() {
    const now = Date.now();
    if (now - contextLostAt < CONTEXT_LOST_REPEAT_MS) return;
    contextLostAt = now;
    notifier.error(CONTEXT_LOST_NOTICE, { key: "context-lost", durationMs: 10_000 });
  }

  function onSendError(err: unknown) {
    if (isContextInvalidated(err)) onContextLost();
  }

  return {
    broadcast(payload) {
      // `runtime.id` disappears once the extension context is invalidated.
      if (!chrome.runtime?.id) {
        onContextLost();
        return;
      }

      try {
        chrome.runtime
          .sendMessage({
            ...payload,
            action: ACTIONS.BROADCAST,
            originWindowId: windowId,
            framePath: getFramePath(),
          })
          .catch(onSendError);
      } catch (err) {
        onSendError(err);
      }
    },
    onRemote(handler) {
      const listener = (message: Parameters<typeof handler>[0]) => {
        if (message.action !== ACTIONS.EXECUTE) return;
        if (message.originWindowId === windowId) return;
        // Ratios and points are relative to the sender's frame, so only the
        // frame at the same position in this tab's frame tree may apply it.
        if (message.framePath !== getFramePath()) return;

        handler(message);
      };

      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    },
  };
}
