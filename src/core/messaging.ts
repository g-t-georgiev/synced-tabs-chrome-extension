import type { MessageController } from "../shared/types";
import { ACTIONS } from "../shared/constants";

export function createTransport({ windowId }: { windowId: string; }): MessageController {
  return {
    broadcast(payload) {
      chrome.runtime.sendMessage({
        ...payload,
        action: ACTIONS.BROADCAST,
        originWindowId: windowId,
      }).catch(() => {
        //
      });
    },
    onRemote(handler) {
      const listener = (message: Parameters<typeof handler>[0]) => {
        if (message.action !== ACTIONS.EXECUTE) return;
        if (message.originWindowId === windowId) return;

        handler(message);
      };

      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    }
  };
}