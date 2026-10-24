import { MESSAGE_TYPES } from "../shared/constants";
import { pointToRatio, ratioToPoint, rAfThrottle, isPointerEventSupported } from "../dom";
import type { CursorController, Feature, MessageController, StateConfigKey } from "../shared/types";

type CursorSyncKey = Extract<StateConfigKey, "syncCursor">;
interface CursorSyncPayload {
  type: string;
  xRatio: number;
  yRatio: number;
}

export function createCursorSync({ transport, cursor }: { transport: MessageController; cursor: CursorController; }): Feature<CursorSyncKey, CursorSyncPayload> {
  const eventType = isPointerEventSupported() ? "pointermove" : "mousemove";

  return {
    configKey: "syncCursor",
    handles: [MESSAGE_TYPES.POINTER_MOVE],
    silent: true,

    capture() {
      const broadcast = rAfThrottle(
        (xRatio: number, yRatio: number) => {
          transport.broadcast({ type: MESSAGE_TYPES.POINTER_MOVE, xRatio, yRatio });
        }
      );

      const onMove = (event: MouseEvent) => {
        if (!event.isTrusted) return;
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