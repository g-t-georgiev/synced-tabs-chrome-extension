import type { Feature, MessageController, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  elementAt,
  rAfThrottle,
  elementCenterToRatio,
  ratioToPoint,
  ratioToScrollOffset,
  scrollOffsetToRatio,
  findScrollableAncestor,
} from "../dom";

type TTarget = HTMLElement | Document;
type ScrollSyncKey = Extract<StateConfigKey, "syncScroll">;
interface ScrollSyncPayload {
  type: string;
  isDocument: boolean;
  xRatio: number;
  yRatio: number;
  xPoint: number;
  yPoint: number;
};

const EVENT_TYPE = "scroll";

export function createScrollSync({ transport }: { transport: MessageController }): Feature<ScrollSyncKey, ScrollSyncPayload> {
  const pendingEchoes: WeakMap<HTMLElement, Pick<DOMRect, "top" | "left">> = new WeakMap();

  return {
    configKey: "syncScroll",
    handles: [MESSAGE_TYPES.SCROLL_EVENT],
    silent: false,

    capture() {
      const broadcast = rAfThrottle(
        (target: Document | HTMLElement) => {
          const isDocument = target instanceof Document;
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

      const onScroll = (event: Event) => {
        if (!event.isTrusted) return;

        const { target } = event;

        if (!(target instanceof Document) && !(target instanceof HTMLElement)) return;

        broadcast(target);
      };

      window.addEventListener(EVENT_TYPE, onScroll, true); // capture: true so nested scroll containers are included
      return () => {
        window.removeEventListener(EVENT_TYPE, onScroll, true);
        broadcast.cancel();
      };
    },

    apply(message) {
      let target: HTMLElement | undefined;
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