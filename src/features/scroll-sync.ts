import type {
  Feature,
  MessageController,
  ScrollEcho,
  StateConfigKey,
  Viewport,
} from "../shared/types";
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
  viewportMatches,
  viewportMismatch,
  anchorAt,
  resolveAnchor,
  type ElementAnchor,
} from "../dom";

type ScrollSyncKey = Extract<StateConfigKey, "syncScroll">;
interface ScrollSyncPayload {
  type: string;
  isDocument: boolean;
  xRatio: number;
  yRatio: number;
  xPoint: number;
  yPoint: number;
  viewport?: Viewport;
  /** The inner container, for receivers whose window size differs. */
  anchor?: ElementAnchor;
}

const EVENT_TYPE = "scroll";
/** The element at a container's centre is usually some levels inside it. */
const CONTAINER_SEARCH_DEPTH = 8;
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

  // Scrolls received while the tab is hidden, replayed once it becomes visible.
  const deferred: Map<string, ScrollSyncPayload> = new Map();

  /** The inner container a message targets here, or null when it can't be trusted. */
  function nestedTarget(message: ScrollSyncPayload): HTMLElement | null {
    const point = ratioToPoint(message.xPoint, message.yPoint);
    if (viewportMatches(message.viewport))
      return findScrollableAncestor(elementAt(point.x, point.y));

    // A different window size: use the container only if the same one is there.
    const resolved = message.anchor
      ? resolveAnchor(message.anchor, point, CONTAINER_SEARCH_DEPTH)
      : null;
    return resolved?.element instanceof HTMLElement ? resolved.element : null;
  }

  function applyScroll(message: ScrollSyncPayload) {
    let target: HTMLElement | null;
    if (message.isDocument) {
      target = document.documentElement;
    } else {
      target = nestedTarget(message);
      if (!target) return;
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
  }

  function onVisibilityChange() {
    if (document.hidden || deferred.size === 0) return;
    const pending = [...deferred.values()];
    deferred.clear();
    pending.forEach(applyScroll);
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

        transport.broadcast(
          {
            type: MESSAGE_TYPES.SCROLL_EVENT,
            // document/window scroll vs nested overflow container
            isDocument,
            xRatio: ratio.x,
            yRatio: ratio.y,
            // optional: help target nested scrollers
            xPoint: point.x,
            yPoint: point.y,
            ...(isDocument ? {} : { anchor: containerAnchor(el) }),
          },
          // Page scrolls are ratio-based and always apply; inner ones are found by
          // position and can be dropped, so only those are worth a report.
          isDocument ? undefined : { report: "Scrolls inside panels" },
        );
      });

      const onScroll = (event: Event) => {
        if (!event.isTrusted) return;

        const { target } = event;

        if (!(target instanceof Document) && !(target instanceof HTMLElement)) return;

        broadcast(target);
      };

      window.addEventListener(EVENT_TYPE, onScroll, true); // capture: true so nested scroll containers are included
      document.addEventListener("visibilitychange", onVisibilityChange);
      return () => {
        window.removeEventListener(EVENT_TYPE, onScroll, true);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        broadcast.cancel();
        // Don't replay stale scrolls if the feature is turned back on later.
        deferred.clear();
      };
    },

    apply(message) {
      // Page scrolls are ratios of the scroll range and work at any size; an inner
      // container is found by position, which a different window size moves, so it must
      // be the same container (see `nestedTarget`).
      if (!message.isDocument && !nestedTarget(message)) return viewportMismatch();

      if (document.hidden) {
        const key = deferKey(message);
        // Re-insert so replay order follows arrival order.
        deferred.delete(key);
        deferred.set(key, message);
        return;
      }
      applyScroll(message);
    },
  };
}

/** Anchors an inner container at its centre. */
function containerAnchor(el: Element): ElementAnchor {
  const rect = el.getBoundingClientRect();
  return anchorAt(el, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

// Identifies the scroll container a message targets, so a hidden tab keeps the
// latest position per container instead of only the latest message overall.
function deferKey(message: ScrollSyncPayload) {
  return message.isDocument ? "document" : `${message.xPoint}:${message.yPoint}`;
}
