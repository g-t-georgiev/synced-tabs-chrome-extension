import type {
  Feature,
  KeyboardEventData,
  Logger,
  MessageController,
  StateConfigKey,
} from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  elementAt,
  isFromOwnUi,
  closestHTMLElement,
  ratioToPoint,
  rectCenterToRatio,
  buildKeyboardEventData,
  dispatchSyntheticKeyboardEvent,
  performKeyDefault,
  viewportMatches,
  anchorAt,
  resolveAnchor,
  type ElementAnchor,
} from "../dom";

type KeyboardSyncKey = Extract<StateConfigKey, "syncKeyboard">;
interface KeyboardSyncPayload {
  type: string;
  subType: string;
  keyData: KeyboardEventData;
  xRatio: number;
  yRatio: number;
  /**
   * The element the sender's key went to, unless that was the page itself (nothing
   * focused). Absent in messages from older builds.
   */
  anchor?: ElementAnchor;
}

const KEY_TYPES = ["keydown", "keypress", "keyup"] as const;
const EMPTY_RECT = { left: 0, top: 0, width: 0, height: 0 };

export function createKeyboardSync({
  transport,
  logger,
}: {
  transport: MessageController;
  logger: Logger;
}): Feature<KeyboardSyncKey, KeyboardSyncPayload> {
  /** Element each held key was dispatched to, keyed by `KeyboardEvent.code`. */
  const keyTargets: Map<string, Element> = new Map();
  /** Held keys whose keydown the page cancelled: their keyup doesn't activate either. */
  const cancelled: Set<string> = new Set();

  return {
    configKey: "syncKeyboard",
    handles: [MESSAGE_TYPES.KEY_EVENT],
    silent: false,

    capture() {
      const onKey = (event: KeyboardEvent) => {
        if (!event.isTrusted || isFromOwnUi(event)) return;

        // The innermost target, also inside open shadow roots.
        const path = event.composedPath()[0];
        const origin = path instanceof Element ? path : document.activeElement;
        const rect = origin?.getBoundingClientRect() ?? EMPTY_RECT;
        const ratio = rectCenterToRatio(rect);
        const onPage = origin === document.body || origin === document.documentElement;

        transport.broadcast({
          type: MESSAGE_TYPES.KEY_EVENT,
          subType: event.type,
          keyData: buildKeyboardEventData(event),
          xRatio: ratio.x,
          yRatio: ratio.y,
          ...(origin && !onPage
            ? { anchor: anchorAt(origin, rect.left + rect.width / 2, rect.top + rect.height / 2) }
            : {}),
        });
      };

      KEY_TYPES.forEach((type) => window.addEventListener(type, onKey, true));
      return () => KEY_TYPES.forEach((type) => window.removeEventListener(type, onKey, true));
    },

    apply(message) {
      const { keyData, subType } = message;
      // One target per physical key, so overlapping keys (e.g. Shift held while typing)
      // keep their own target until their own keyup.
      const id = keyData.code || keyData.key;
      const fresh = subType === "keydown" && !keyData.repeat;
      let target = fresh ? undefined : keyTargets.get(id);

      if (!target) {
        // With a different window size the point may hit the wrong element, so keys go to
        // whatever has focus instead (page-level shortcuts like the spin key still work).
        const point = viewportMatches(message.viewport)
          ? ratioToPoint(message.xRatio, message.yRatio)
          : null;
        target = (point && elementAt(point.x, point.y)) ?? document.activeElement ?? document.body;
        if (!target) return;
        if (subType === "keydown") closestHTMLElement(target)?.focus();
      }

      if (subType === "keyup") keyTargets.delete(id);
      else keyTargets.set(id, target);

      logger.execute(subType, `[${keyData.code}] on:`, target);
      const proceed = dispatchSyntheticKeyboardEvent(target, subType, keyData);

      // Synthetic keys have no default actions: do the browser's Enter/Space activation
      // ourselves, unless the page cancelled this key (on its keydown or now).
      // A fresh press starts clean: a cancelled press whose keyup never arrived (the window
      // lost focus mid-press) mustn't block this one.
      if (fresh) cancelled.delete(id);
      if (subType === "keydown" && !proceed) cancelled.add(id);
      const wasCancelled = cancelled.has(id);
      if (subType === "keyup") cancelled.delete(id);
      if (proceed && !wasCancelled && isSendersTarget(message, target)) {
        performKeyDefault(target, subType, keyData);
      }
    },
  };
}

/**
 * Whether `target` is the element the sender's key went to: the same element (identity and
 * box, scaled when window sizes differ) found from the sender's anchor. Defaults press
 * buttons and submit forms, so they only run on that element, never on whatever happens to
 * sit at the point or have focus here (with nothing focused in the sender, there's no anchor
 * and nothing is done).
 */
function isSendersTarget(
  message: KeyboardSyncPayload & { viewport?: { w: number; h: number } },
  target: Element,
) {
  if (!message.anchor) return false;
  const point = ratioToPoint(message.xRatio, message.yRatio);
  return resolveAnchor(message.anchor, point, { sender: message.viewport })?.element === target;
}
