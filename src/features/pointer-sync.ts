import type {
  ApplyResult,
  Feature,
  Logger,
  MessageController,
  StateConfigKey,
} from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  elementAt,
  isFromOwnUi,
  ratioToPoint,
  pointToRatio,
  dispatchSyntheticPointerEvent,
  viewportMatches,
  viewportMismatch,
  anchorAt,
  resolveAnchor,
  isWithin,
  type ElementAnchor,
} from "../dom";

type PointerSyncKey = Extract<StateConfigKey, "syncMouse">;
interface PointerSyncPayload {
  type: string;
  subType: string;
  xRatio: number;
  yRatio: number;
  /** Absent in messages from a tab still running an older build of the extension. */
  button?: number;
  buttons?: number;
  /** The element under the pointer. Absent in messages from older builds. */
  anchor?: ElementAnchor;
}

const EVENT_TYPES = ["pointerdown", "pointerup", "click"] as const;
const ELEMENT_MISMATCH: ApplyResult = { status: "dropped", reason: "element-mismatch" };

export function createPointerSync({
  transport,
  logger,
}: {
  transport: MessageController;
  logger: Logger;
}): Feature<PointerSyncKey, PointerSyncPayload> {
  return {
    configKey: "syncMouse",
    handles: [MESSAGE_TYPES.POINTER_EVENT],
    silent: false,

    capture() {
      const onPointer = (event: MouseEvent) => {
        // Clicks on our own panel never become page clicks in other tabs.
        if (!event.isTrusted || isFromOwnUi(event)) return;

        const ratio = pointToRatio(event.clientX, event.clientY);
        const target = event.composedPath()[0];

        transport.broadcast(
          {
            type: MESSAGE_TYPES.POINTER_EVENT,
            subType: event.type,
            xRatio: ratio.x,
            yRatio: ratio.y,
            button: event.button,
            buttons: event.buttons,
            ...(target instanceof Element
              ? { anchor: anchorAt(target, event.clientX, event.clientY) }
              : {}),
          },
          // One report per press: up and click are dropped for the same reason as down.
          event.type === "pointerdown" ? { report: "Clicks" } : undefined,
        );
      };

      EVENT_TYPES.forEach((type) => {
        window.addEventListener(type, onPointer, true);
      });
      return () => {
        EVENT_TYPES.forEach((type) => window.removeEventListener(type, onPointer, true));
      };
    },

    apply(message) {
      let point = ratioToPoint(message.xRatio, message.yRatio);
      const sameSize = viewportMatches(message.viewport);
      let element: Element | null;

      if (message.anchor) {
        // Click only the same element, in the same box (scaled when the window sizes
        // differ), at the same spot inside it. A different element there (another branch's
        // layout, a neighbouring row, fixed-pixel UI on a screen that scales differently)
        // is dropped rather than clicked.
        const drop = sameSize ? ELEMENT_MISMATCH : viewportMismatch();
        const resolved = resolveAnchor(message.anchor, point, { sender: message.viewport });
        if (!resolved) return drop;

        point = { x: resolved.x, y: resolved.y };
        element = elementAt(point.x, point.y);
        // Something else covers that spot here: don't click it instead.
        if (!element || !isWithin(element, resolved.element)) return drop;
      } else if (sameSize) {
        // An older build sent no anchor: click whatever is at the point, as before.
        element = elementAt(point.x, point.y);
      } else {
        return viewportMismatch();
      }

      // Outside this viewport: drop rather than clicking an unrelated fallback like <body>.
      if (!element) return;

      logger.execute(
        message.subType,
        `at (${Math.round(point.x)}px, ${Math.round(point.y)}px) on:`,
        element,
      );
      dispatchSyntheticPointerEvent(element, message.subType, point.x, point.y, {
        // Older senders (before button state was sent) mean a primary-button press.
        button: message.button ?? 0,
        buttons: message.buttons ?? (message.subType === "pointerdown" ? 1 : 0),
      });
    },
  };
}
