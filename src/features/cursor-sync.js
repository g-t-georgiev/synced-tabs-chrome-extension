import { MESSAGE_TYPES } from "../constants.js";
import { pointToRatio, ratioToPoint, rAfThrottle, isPointerEventSupported } from "../dom/index.js";

/** @typedef {Extract<import("../constants.js").StateConfigKey, "syncCursor">} CursorSyncKey */
/**
 * @typedef {{
*  type: string;
*  xRatio: number;
*  yRatio: number;
* }} CursorSyncPayload
*/

/**
 * @template {import("../constants.js").StateConfig} State
 * @param {object} options
 * @param {ReturnType<typeof import("../core/state-store.js").createStore<State>>} options.config
 * @param {ReturnType<typeof import("../core/messaging.js").createTransport>} options.transport
 * @param {ReturnType<typeof import("../ui/cursor.js").createCursor>} options.cursor
 * @returns {import("../core/sync-engine.js").Feature<CursorSyncKey, CursorSyncPayload>}
 */
export function createCursorSync({ config, transport, cursor }) {
  const eventType = isPointerEventSupported() ? "pointermove" : "mousemove";

  return {
    configKey: "syncCursor",
    handles: [MESSAGE_TYPES.POINTER_MOVE],
    silent: true,

    capture() {
      const broadcast = rAfThrottle(
        /**
         * @param {number} xRatio
         * @param {number} yRatio
         * @returns
         */
        (xRatio, yRatio) => {
          transport.broadcast({ type: MESSAGE_TYPES.POINTER_MOVE, xRatio, yRatio });
        }
      );
      
      /**
       * @param {PointerEvent} event
       * @returns
       */
      const onMove = (event) => {
        if (!event.isTrusted || !config.state.syncCursor) return;
        const ratio = pointToRatio(event.clientX, event.clientY);
        broadcast(ratio.x, ratio.y);
      }

      window.addEventListener(eventType, onMove, { capture: true, passive: true });
      return () => {
        window.removeEventListener(eventType, onMove, true);
        broadcast.cancel();
      };
    },

    apply(message) {
      const point = ratioToPoint(message.xRatio, message.yRatio);
      cursor.moveTo(point.x, point.y);
    }
  };
}