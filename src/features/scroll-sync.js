import { MESSAGE_TYPES } from "../constants.js";
import {
  elementAt,
  rAfThrottle,
  elementCenterToRatio,
  ratioToPoint,
  ratioToScrollOffset,
  scrollOffsetToRatio,
  findScrollableAncestor,
} from "../dom/index.js";

const EVENT_TYPE = "scroll";

/** @typedef {Extract<import("../constants.js").StateConfigKey, "syncScroll">} ScrollSyncKey */
/**
 * @typedef {{
 *  type: string;
 *  isDocument: boolean;
 *  xRatio: number;
 *  yRatio: number;
 *  xPoint: number;
 *  yPoint: number;
 * }} ScrollSyncPayload
 */

/** @typedef {Element | Document} TTarget */

/**
 * @param {object} options
 * @param {import("../constants.js").MessageController} options.transport
 * @returns {import("../constants.js").Feature<ScrollSyncKey, ScrollSyncPayload>}
 */
export function createScrollSync({ transport }) {
  /** @type {WeakMap<TTarget, { top: number; left: number; }>} */
  const pendingEchoes = new WeakMap();

  return {
    configKey: "syncScroll",
    handles: [MESSAGE_TYPES.SCROLL_EVENT],
    silent: false,

    capture() {
      const broadcast = rAfThrottle(
        /** @param {TTarget} target */
        (target) => {
          const isDocument = target === document;
          const el = isDocument ? document.documentElement : target;

          const echo = pendingEchoes.get(el);
          if (echo) {
            pendingEchoes.delete(el);
            const deltaX = el.scrollLeft - echo.left;
            const deltaY = el.scrollTop - echo.top;
            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
          }

          const ratio = scrollOffsetToRatio(el);
          const point = isDocument ? { x: 0.5, y: 0.5 } : elementCenterToRatio(el);
    
          transport.broadcast({
            type: MESSAGE_TYPES.SCROLL_EVENT,
            // document/window scroll vs nested overflow container
            isDocument,
            xRatio: ratio.x,
            yRatio: ratio.y,
            // optional: help target nested scrollers
            xPoint: point.x,
            yPoint: point.y,
          });
        }
      );

      /**
       * @param {Event} event
       * @returns
       */
      const onScroll = (event) => {
        if (!event.isTrusted) return;
        broadcast(event.target);
      };

      window.addEventListener(EVENT_TYPE, onScroll, true); // capture: true so nested scroll containers are included
      return () => {
        window.removeEventListener(EVENT_TYPE, onScroll, true);
        broadcast.cancel();
      };
    },

    apply(message) {
      let target;
      if (message.isDocument) {
        target = document.documentElement;
      } else {
        const point = ratioToPoint(message.xPoint, message.yPoint);
        target = elementAt(point.x, point.y);
        target = findScrollableAncestor(target);
      }

      const offset = ratioToScrollOffset(target, message.xRatio, message.yRatio);
      pendingEchoes.set(target, offset);
      target.scrollTo({ top: offset.top, left: offset.left, behavior: "auto" });
    }
  };
}