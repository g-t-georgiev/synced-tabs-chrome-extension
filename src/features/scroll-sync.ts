import type { Feature, MessageController, ScrollEcho, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  elementAt,
  rAfThrottle,
  elementCenterToRatio,
  ratioToPoint,
  ratioToScrollOffset,
  scrollOffsetToRatio,
  findScrollableAncestor,
  afterFrames,
} from "../dom";

type ScrollSyncKey = Extract<StateConfigKey, "syncScroll">;
interface ScrollSyncPayload {
  type: string;
  isDocument: boolean;
  xRatio: number;
  yRatio: number;
  xPoint: number;
  yPoint: number;
}

const EVENT_TYPE = "scroll";
// Echo lifetime represented as rendered frames
const ECHO_FRAMES = 3;

export function createScrollSync({
  transport,
}: {
  transport: MessageController;
}): Feature<ScrollSyncKey, ScrollSyncPayload> {
  const pendingEchoes: WeakMap<Element, ScrollEcho> = new WeakMap();

  function isEcho(el: Element) {
    const echo = pendingEchoes.get(el);
    if (!echo) return false;
    pendingEchoes.delete(el);
    const deltaX = el.scrollLeft - echo.left;
    const deltaY = el.scrollTop - echo.top;
    return Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1;
  }

  return {
    configKey: "syncScroll",
    handles: [MESSAGE_TYPES.SCROLL_EVENT],
    silent: false,

    capture() {
      const broadcast = rAfThrottle((target: Document | HTMLElement) => {
        const isDocument = target instanceof Document;
        const el = isDocument ? document.documentElement : target;

        if (isEcho(el)) return;

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
      });

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
      const prevTop = target.scrollTop;
      const prevLeft = target.scrollLeft;
      target.scrollTo({ top: offset.top, left: offset.left, behavior: "instant" });

      // No movement means no scroll event will fire, so there is no echo to suppress.
      if (target.scrollTop === prevTop && target.scrollLeft === prevLeft) return;

      const echo: ScrollEcho = { top: target.scrollTop, left: target.scrollLeft };
      pendingEchoes.set(target, echo);

      afterFrames(ECHO_FRAMES, () => {
        // Only clear our own entry, not a newer one set by a later message.
        if (pendingEchoes.get(target) === echo) pendingEchoes.delete(target);
      });
    },
  };
}
