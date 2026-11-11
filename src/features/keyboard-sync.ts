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
  viewportMatches,
} from "../dom";

type KeyboardSyncKey = Extract<StateConfigKey, "syncKeyboard">;
interface KeyboardSyncPayload {
  type: string;
  subType: string;
  keyData: KeyboardEventData;
  xRatio: number;
  yRatio: number;
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

  return {
    configKey: "syncKeyboard",
    handles: [MESSAGE_TYPES.KEY_EVENT],
    silent: false,

    capture() {
      const onKey = (event: KeyboardEvent) => {
        if (!event.isTrusted || isFromOwnUi(event)) return;

        const origin = event.target instanceof Element ? event.target : document.activeElement;
        const rect = origin?.getBoundingClientRect() ?? EMPTY_RECT;
        const ratio = rectCenterToRatio(rect);

        transport.broadcast({
          type: MESSAGE_TYPES.KEY_EVENT,
          subType: event.type,
          keyData: buildKeyboardEventData(event),
          xRatio: ratio.x,
          yRatio: ratio.y,
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
      dispatchSyntheticKeyboardEvent(target, subType, keyData);
    },
  };
}
