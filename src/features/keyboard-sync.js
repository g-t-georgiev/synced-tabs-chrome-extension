import { MESSAGE_TYPES } from "../constants.js";
import {
  elementAt,
  ratioToPoint,
  rectCenterToRatio,
  buildKeyboardEventData,
  dispatchSyntheticKeyboardEvent 
} from "../dom/index.js";

const KEY_TYPES = ["keydown", "keypress", "keyup"];
const EMPTY_RECT = { left: 0, top: 0, width: 0, height: 0 };

/** @typedef {Extract<import("../constants.js").StateConfigKey, "syncKeyboard">} KeyboardSyncKey */
/**
 * @typedef {{
 *  type: string;
 *  subType: string;
 *  keyData: import("../dom/synthetic-events.js").KeyboardEventData
 *  xRatio: number;
 *  yRatio: number;
 * }} KeyboardSyncPayload
 */

/**
 * @template {import("../constants.js").StateConfig} State
 * @param {object} options
 * @param {import("../constants.js").StateStore<State>} options.config
 * @param {import("../constants.js").MessageController} options.transport
 * @param {import("../constants.js").Logger} options.logger
 * @returns {import("../constants.js").Feature<KeyboardSyncKey, KeyboardSyncPayload>}
 */
export function createKeyboardSync({ config, transport, logger }) {
  /** @type {Element | null} */
  let syncKeyTarget = null;

  return {
    configKey: "syncKeyboard",
    handles: [MESSAGE_TYPES.KEY_EVENT],
    silent: false,

    capture() {
      /**
       * @param {KeyboardEvent} event
       * @returns
       */
      const onKey = (event) => {
        if (!event.isTrusted || !config.state.syncKeyboard) return;

        const origin = event.target || document.activeElement || document.body;
        const rect = "getBoundingClientRect" in origin ? origin.getBoundingClientRect() : EMPTY_RECT;
        const ratio = rectCenterToRatio(rect);

        transport.broadcast({
          type: MESSAGE_TYPES.KEY_EVENT,
          subType: event.type,
          keyData: buildKeyboardEventData(event),
          xRatio: ratio.x,
          yRatio: ratio.y,
        });
      };

      KEY_TYPES.forEach((type) => window.addEventListener(type, onKey, true));
      return () => KEY_TYPES.forEach((type) => window.removeEventListener(type, onKey, true));
    },

    apply(message) {
      if (message.subType === "keydown" || !syncKeyTarget) {
        const point = ratioToPoint(message.xRatio, message.yRatio);
        syncKeyTarget = elementAt(point.x, point.y, document.activeElement ?? document.body);
        if ("focus" in syncKeyTarget) syncKeyTarget.focus();
      }

      if (syncKeyTarget) {
        logger.execute(message.subType, `[${message.keyData.code}] on:`, syncKeyTarget);
        dispatchSyntheticKeyboardEvent(syncKeyTarget, message.subType, message.keyData);
      }

      if (message.subType !== "keyup") return;

      syncKeyTarget = null;
    }
  };
}