import { ACTIONS } from "../constants.js";

/**
 * @template {object} T
 * @typedef {T & { action: string; originWindowId: string; }} Message
 */

/**
 * @param {object} options
 * @param {string} options.windowId
 */
export function createTransport({ windowId }) {
  return {
    /**
     * @template {any} T
     * @param {T} payload
     */
    broadcast(payload) {
      chrome.runtime.sendMessage({
        ...payload,
        action: ACTIONS.BROADCAST,
        originWindowId: windowId,
      }).catch(() => {
        //
      });
    },
    /**
     * @template {object} T
     * @param {((message: Message<T>) => void)} handler Custom handler
     * @returns {() => void} Unsubscribe function
     */
    onRemote(handler) {
      /**
       * @param {Message<T>} message
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