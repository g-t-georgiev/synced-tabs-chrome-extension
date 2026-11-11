import type { Feature, Logger, MessageController, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  elementAt,
  isFromOwnUi,
  ratioToPoint,
  pointToRatio,
  dispatchSyntheticPointerEvent,
  viewportMatches,
  viewportMismatch,
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
}

const EVENT_TYPES = ["pointerdown", "pointerup", "click"] as const;

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

        transport.broadcast(
          {
            type: MESSAGE_TYPES.POINTER_EVENT,
            subType: event.type,
            xRatio: ratio.x,
            yRatio: ratio.y,
            button: event.button,
            buttons: event.buttons,
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
      // A different window size puts fixed-pixel UI elsewhere: don't click the wrong thing.
      if (!viewportMatches(message.viewport)) return viewportMismatch();

      const point = ratioToPoint(message.xRatio, message.yRatio);
      const element = elementAt(point.x, point.y);

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
