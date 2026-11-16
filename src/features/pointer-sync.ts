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
  matchAnchor,
  isWithin,
  describeElement,
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
  /**
   * On `click`: whether the sender's click landed on the element it pressed (the browser
   * otherwise clicks an element containing both). Absent in messages from older builds.
   */
  samePress?: boolean;
}

const EVENT_TYPES = ["pointerdown", "pointerup", "pointercancel", "click"] as const;
const ELEMENT_MISMATCH: ApplyResult = { status: "dropped", reason: "element-mismatch" };

type Point = { x: number; y: number };

/**
 * The receiver's decision for the press in progress, made on its `pointerdown`: either the
 * element it pressed, or the reason it dropped the press.
 */
type Press = { element: Element; point: Point; released: boolean } | Dropped;

/** A drop: the answer for the sender (nothing for off-screen points) and why, for the log. */
type Dropped = { dropped: ApplyResult | undefined; why: string };

export function createPointerSync({
  transport,
  logger,
}: {
  transport: MessageController;
  logger: Logger;
}): Feature<PointerSyncKey, PointerSyncPayload> {
  let press: Press | null = null;

  /**
   * The element to dispatch at, found like a real click would: the same element as the
   * sender's (same identity, same box, scaled when the window sizes differ), at the same
   * spot inside it. A different element there is a drop, never a click on something else.
   */
  function resolve(
    message: PointerSyncPayload & { viewport?: { w: number; h: number } },
  ): { element: Element; point: Point } | Dropped {
    let point = ratioToPoint(message.xRatio, message.yRatio);
    const sameSize = viewportMatches(message.viewport);
    // Both window sizes, when they differ: the first thing to check when diagnosing a drop.
    const sizes =
      sameSize || !message.viewport
        ? ""
        : ` [sender ${message.viewport.w}x${message.viewport.h}, here ${innerWidth}x${innerHeight}]`;
    let element: Element | null;

    if (message.anchor) {
      const drop = sameSize ? ELEMENT_MISMATCH : viewportMismatch(true);
      const match = matchAnchor(message.anchor, point, { sender: message.viewport });
      if (!match.found) return { dropped: drop, why: match.reason + sizes };

      point = { x: match.x, y: match.y };
      element = elementAt(point.x, point.y);
      if (!element) return { dropped: drop, why: `nothing at the matched spot${sizes}` };
      // Something else covers that spot here: don't click it instead.
      if (!isWithin(element, match.element)) {
        return { dropped: drop, why: `covered by ${describeElement(element)}${sizes}` };
      }
    } else if (sameSize) {
      // An older build sent no anchor: click whatever is at the point, as before.
      element = elementAt(point.x, point.y);
    } else {
      return {
        dropped: viewportMismatch(),
        why: `window size differs and the sender sent no anchor (older build)${sizes}`,
      };
    }

    // Outside this viewport: drop rather than clicking an unrelated fallback like <body>.
    if (!element) return { dropped: undefined, why: "outside this viewport" };
    return { element, point };
  }

  function logDrop(type: string, drop: Dropped) {
    logger.dropped(type, drop.why);
  }

  function dispatch(
    element: Element,
    type: string,
    point: Point,
    message: Pick<PointerSyncPayload, "button" | "buttons">,
  ) {
    logger.execute(type, `at (${Math.round(point.x)}px, ${Math.round(point.y)}px) on:`, element);
    dispatchSyntheticPointerEvent(element, type, point.x, point.y, {
      // Older senders (before button state was sent) mean a primary-button press.
      button: message.button ?? 0,
      buttons: message.buttons ?? (type === "pointerdown" ? 1 : 0),
    });
  }

  /** Releases a press left held down (mouse sync turned off mid-press). */
  function cancelHeldPress() {
    if (press && "element" in press && !press.released && press.element.isConnected) {
      dispatch(press.element, "pointercancel", press.point, { button: 0, buttons: 0 });
    }
    press = null;
  }

  return {
    configKey: "syncMouse",
    handles: [MESSAGE_TYPES.POINTER_EVENT],
    silent: false,

    capture() {
      /** What this tab pressed, to tell receivers whether its click landed on it. */
      let pressed: EventTarget | null = null;

      const onPointer = (event: MouseEvent) => {
        // Clicks on our own panel never become page clicks in other tabs.
        if (!event.isTrusted || isFromOwnUi(event)) return;

        const ratio = pointToRatio(event.clientX, event.clientY);
        const target = event.composedPath()[0] ?? null;
        if (event.type === "pointerdown") pressed = target;

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
            ...(event.type === "click" ? { samePress: target === pressed } : {}),
          },
          // One report per press: the receiver decides the whole press on pointerdown.
          event.type === "pointerdown" ? { report: "Clicks" } : undefined,
        );

        if (event.type === "click") pressed = null;
      };

      EVENT_TYPES.forEach((type) => {
        window.addEventListener(type, onPointer, true);
      });
      return () => {
        EVENT_TYPES.forEach((type) => window.removeEventListener(type, onPointer, true));
        cancelHeldPress();
      };
    },

    apply(message) {
      const { subType } = message;

      if (subType === "pointerdown") {
        // A new press replaces any earlier one; its pointerup or click may never come.
        const target = resolve(message);
        if ("dropped" in target) {
          press = target;
          logDrop(subType, target);
          return target.dropped;
        }
        press = { ...target, released: false };
        dispatch(target.element, subType, target.point, message);
        return;
      }

      // pointerup, pointercancel and click follow the pointerdown's decision, so a button
      // is never pressed without being released, or clicked when its press was dropped.
      const current = press;

      if (current && "dropped" in current) {
        if (subType === "click") press = null;
        logDrop(subType, { ...current, why: "its pointerdown was dropped" });
        return current.dropped;
      }

      if (current && (subType === "pointerup" || subType === "pointercancel")) {
        if (!current.element.isConnected) {
          press = null;
          return;
        }
        // Like pointer capture: the release goes to the pressed element, even if it changed
        // its look (pressed state) or the pointer moved off it.
        const sameSize = viewportMatches(message.viewport);
        const point = sameSize ? ratioToPoint(message.xRatio, message.yRatio) : current.point;
        dispatch(current.element, subType, point, message);
        if (subType === "pointercancel") press = null;
        else current.released = true;
        return;
      }

      if (current && subType === "click" && message.samePress !== false) {
        press = null;
        if (!current.element.isConnected) return;
        dispatch(current.element, subType, current.point, message);
        return;
      }

      // A click that landed elsewhere than the press (the browser picks an element
      // containing both), or an event whose pointerdown never arrived: check it on its own.
      if (subType === "click") press = null;
      const target = resolve(message);
      if ("dropped" in target) {
        logDrop(subType, target);
        return target.dropped;
      }
      dispatch(target.element, subType, target.point, message);
    },
  };
}
