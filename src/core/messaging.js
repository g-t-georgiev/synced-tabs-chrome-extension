import { ACTIONS } from "../constants.js";

/**
 * @param {object} options
 * @param {string} options.windowId
 * @returns {import("../constants.js").MessageController}
 */
export function createTransport({ windowId }) {
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
      /**
       * @param {Parameters<typeof handler>[0]} message
       * @returns {void}
       */
      const listener = (message) => {
        if (message.action !== ACTIONS.EXECUTE) return;
        if (message.originWindowId === windowId) return;

        handler(message);
      };

      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    }
  };
}