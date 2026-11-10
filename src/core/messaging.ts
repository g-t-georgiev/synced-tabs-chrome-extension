import type { MessageController } from "../shared/types";
import { ACTIONS } from "../shared/constants";
import { getFramePath } from "./frame-path";

export function createTransport({ windowId }: { windowId: string }): MessageController {
  return {
    broadcast(payload) {
      chrome.runtime
        .sendMessage({
          ...payload,
          action: ACTIONS.BROADCAST,
          originWindowId: windowId,
          framePath: getFramePath(),
        })
        .catch(() => {
          //
        });
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
