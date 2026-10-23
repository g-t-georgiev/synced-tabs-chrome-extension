
import type { Feature, Logger, MessageController, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  elementAt,
  ratioToPoint,
  pointToRatio,
  isPointerEventSupported,
  dispatchSyntheticPointerEvent,
} from "../dom";

type PointerSyncKey = Extract<StateConfigKey, "syncMouse">;
interface PointerSyncPayload {
  type: string;
  subType: string;
  xRatio: number;
  yRatio: number;
}

const PREFIX = isPointerEventSupported() ? "pointer" : "mouse";
const EVENT_TYPES = [`${PREFIX}down`, `${PREFIX}up`, "click"] as const;

export function createPointerSync({ transport, logger }: { transport: MessageController; logger: Logger; }): Feature<PointerSyncKey, PointerSyncPayload> {
  return {
    configKey: "syncMouse",
    handles: [MESSAGE_TYPES.POINTER_EVENT],
    silent: false,

    capture() {
      const onPointer = (event: MouseEvent) => {
        if (!event.isTrusted) return;

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

      if (!element) return;

      logger.execute(message.subType, `at (${Math.round(point.x)}px, ${Math.round(point.y)}px) on:`, element);
      dispatchSyntheticPointerEvent(element, point.x, point.y, message.subType);
    }
  };
}