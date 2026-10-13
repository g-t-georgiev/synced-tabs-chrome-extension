
import { MESSAGE_TYPES } from "../constants.js";
import {
  elementAt,
  ratioToPoint,
  pointToRatio,
  isPointerEventSupported,
  dispatchSyntheticPointerEvent,
} from "../dom/index.js";

const PREFIX = isPointerEventSupported() ? "pointer" : "mouse";
const EVENT_TYPES = [`${PREFIX}down`, `${PREFIX}up`, "click"];

/** @typedef {Extract<import("../constants.js").StateConfigKey, "syncMouse">} PointerSyncKey */
/**
 * @typedef {{
*  type: string;
*  subType: string;
*  xRatio: number;
*  yRatio: number;
* }} PointerSyncPayload
*/

/**
 * @template {import("../constants.js").StateConfig} State
 * @param {object} options
 * @param {ReturnType<typeof import("../core/state-store.js").createStore<State>>} options.config
 * @param {ReturnType<typeof import("../core/messaging.js").createTransport>} options.transport
 * @param {ReturnType<typeof import("../core/logger.js").createLogger>} options.logger
 * @returns {import("../core/sync-engine.js").Feature<PointerSyncKey, PointerSyncPayload>}
 */
export function createPointerSync({ config, transport, logger }) {
  return {
    configKey: "syncMouse",
    handles: [MESSAGE_TYPES.POINTER_EVENT],
    silent: false,

    capture() {
      /**
       * @param {PointerEvent} event
       * @returns
       */
      const onPointer = (event) => {
        if (!event.isTrusted || !config.state.syncMouse) return;

        const ratio = pointToRatio(event.clientX, event.clientY);

        transport.broadcast({
          type: MESSAGE_TYPES.POINTER_EVENT,
          subType: event.type,
          xRatio: ratio.x,
          yRatio: ratio.y,
        });
      };

      EVENT_TYPES.forEach((type) => {
        window.addEventListener(type, onPointer, true);
      });
      return () => {
        EVENT_TYPES.forEach((type) => window.removeEventListener(type, onPointer, true));
      };
    },

    apply(message) {
      const point = ratioToPoint(message.xRatio, message.yRatio);
      const element = elementAt(point.x, point.y, document.body);

      logger.execute(message.subType, `at (${Math.round(point.x)}px, ${Math.round(point.y)}px) on:`, element);
      dispatchSyntheticPointerEvent(element, point.x, point.y, message.subType);
    }
  };
}