import { DEFAULT_CONFIG, MESSAGE_TYPES } from "./src/constants.js";
import { createStore } from "./src/core/state-store.js";
import {
  pointToRatio,
  ratioToPoint,
  ratioToScrollOffset,
  rectCenterToRatio,
  elementCenterToRatio,
  scrollOffsetToRatio
} from "./src/dom/coordinates.js";
import { elementAt, findScrollableAncestor } from "./src/dom/element-resolver.js";
import { rAfThrottle } from "./src/dom/raf-throttle.js";
import {
  buildKeyboardEventData,
  dispatchSyntheticKeyboardEvent,
  dispatchSyntheticPointerEvent,
  isPointerEventSupported
} from "./src/dom/synthetic-events.js";
import { createWindowId } from "./src/core/window-id.js";
import { createPanel } from "./src/ui/panel.js";
import { createCursor } from "./src/ui/cursor.js";
import { createNullUi } from "./src/ui/null-ui.js";
import { createLogger } from "./src/core/logger.js";
import { createTransport } from "./src/core/messaging.js";

export function main() {
  const windowId = createWindowId();
  const logger = createLogger(windowId);
  const config = createStore({ ...DEFAULT_CONFIG });
  const transport = createTransport({ windowId });
  const ui = window.top === window
    ? createPanel({ windowId, config })
    : createNullUi();
  const cursor = createCursor();

  let syncedKeyTarget = null;

  logger.initialized(window.location.href);
  const pointerPrefix = isPointerEventSupported() ? "pointer" : "mouse";

  // 1. CAPTURE & BROADCAST MOUSE/POINTER CLICKS
  [`${pointerPrefix}down`, `${pointerPrefix}up`, "click"].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (!event.isTrusted || !config.state.syncMouse) return;

      const ratio = pointToRatio(event.clientX, event.clientY);

      transport.broadcast({
        type: MESSAGE_TYPES.POINTER_EVENT,
        subType: type,
        xRatio: ratio.x,
        yRatio: ratio.y,
      });
    }, true);
  });

  // 2. CAPTURE & BROADCAST GHOST CURSOR MOVEMENT
  const broadcastCursor = rAfThrottle(
    /**
     * @param {number} xRatio
     * @param {number} yRatio
     */
    (xRatio, yRatio) => {
      transport.broadcast({
        type: MESSAGE_TYPES.POINTER_MOVE,
        xRatio,
        yRatio,
      });
    }
  );

  window.addEventListener(`${pointerPrefix}move`, (event) => {
    if (!event.isTrusted || !config.state.syncCursor) return;
    const ratio = pointToRatio(event.clientX, event.clientY);
    broadcastCursor(ratio.x, ratio.y);
  }, { capture: true, passive: true });

  // 3. CAPTURE & BROADCAST KEYBOARD EVENTS
  ["keydown", "keypress", "keyup"].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (!event.isTrusted || !config.state.syncKeyboard) return;

      const originTarget = event.target || document.activeElement || document.body;
      const rect = originTarget.getBoundingClientRect ? originTarget.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const ratio = rectCenterToRatio(rect);
      const keyData = buildKeyboardEventData(event);

      transport.broadcast({
        type: MESSAGE_TYPES.KEY_EVENT,
        subType: type,
        keyData,
        xRatio: ratio.x,
        yRatio: ratio.y, 
      });
    }, true);
  });

  // 4. CAPTURE & BROADCAST SCROLL EVENTS
  const broadcastScroll = rAfThrottle(
    /** @param {Element | Document} target */
    (target) => {
      const isDocument = target === document;
      const el = isDocument ? document.documentElement : target;
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

  window.addEventListener("scroll", (event) => {
    if (!event.isTrusted || !config.state.syncScroll) return;
    broadcastScroll(event.target);
  }, true); // capture: true so nested scroll containers are included

  // 5. LISTEN FOR INCOMING BROADCASTS FROM OTHER WINDOWS
  transport.onRemote(
    /**
     * @param {import("./src/core/messaging.js").Message<{
     *  type: string;
     *  subType: string;
     *  isDocument: boolean;
     *  keyData: import("./src/dom/synthetic-events.js").KeyboardEventData;
     *  xRatio: number;
     *  yRatio: number;
     *  xPoint: number;
     *  yPoint: number;
     * }>} message
     */
    (message) => {
      // Isolate POINTER_MOVE from the heavy UI pulse & logging to save performance
      if (message.type === MESSAGE_TYPES.POINTER_MOVE && config.state.syncCursor) {
        const point = ratioToPoint(message.xRatio, message.yRatio);
        cursor.moveTo(point.x, point.y);
        return;
      }

      ui.flash();
      logger.remote(message);

      // A. EXECUTE POINTER / CLICK
      if ((message.type === MESSAGE_TYPES.POINTER_EVENT) && config.state.syncMouse) {
        ui.pulse();

        const point = ratioToPoint(message.xRatio, message.yRatio);
        const element = elementAt(point.x, point.y, document.body);

        logger.execute(message.subType, `at (${Math.round(point.x)}px, ${Math.round(point.y)}px) on:`, element);
        dispatchSyntheticPointerEvent(element, point.x, point.y, message.subType);
      }
      // B. EXECUTE KEYBOARD EVENT
      else if (message.type === MESSAGE_TYPES.KEY_EVENT && config.state.syncKeyboard) {
        ui.pulse();

        if (message.subType === "keydown" || !syncedKeyTarget) {
          const point = ratioToPoint(message.xRatio, message.yRatio);
          syncedKeyTarget = elementAt(point.x, point.y, document.activeElement ?? document.body);

          if (typeof syncedKeyTarget.focus === "function") {
            syncedKeyTarget.focus();
          }
        }

        if (syncedKeyTarget) {
          logger.execute(message.subType, `[${message.keyData.code}] on:`, syncedKeyTarget);
          dispatchSyntheticKeyboardEvent(syncedKeyTarget, message.subType, message.keyData);
        }

        if (message.subType === "keyup") {
          syncedKeyTarget = null;
        }
      }
      // C. EXECUTE SCROLL EVENT
      else if (message.type === MESSAGE_TYPES.SCROLL_EVENT && config.state.syncScroll) {
        ui.pulse();

        let target;
        if (message.isDocument) {
          target = document.documentElement;
        } else {
          const point = ratioToPoint(message.xPoint, message.yPoint);
          target = elementAt(point.x, point.y);
          target = findScrollableAncestor(target);
        }

        const offset = ratioToScrollOffset(target, message.xRatio, message.yRatio);

        target.scrollTo({
          top: offset.top,
          left: offset.left,
          behavior: "auto", // instant; "smooth" desyncs mid-scroll
        });
      }
    }
  );
}