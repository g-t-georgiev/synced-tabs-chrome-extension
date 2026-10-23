import type { Feature, KeyboardEventData, Logger, MessageController, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  elementAt,
  ratioToPoint,
  rectCenterToRatio,
  buildKeyboardEventData,
  dispatchSyntheticKeyboardEvent
} from "../dom";

type KeyboardSyncKey = Extract<StateConfigKey, "syncKeyboard">;
interface KeyboardSyncPayload {
  type: string;
  subType: string;
  keyData: KeyboardEventData
  xRatio: number;
  yRatio: number;
}

const KEY_TYPES = ["keydown", "keypress", "keyup"] as const;
const EMPTY_RECT = { left: 0, top: 0, width: 0, height: 0 };

export function createKeyboardSync({ transport, logger }: { transport: MessageController; logger: Logger; }): Feature<KeyboardSyncKey, KeyboardSyncPayload> {
  let syncKeyTarget: HTMLElement | null = null;

  return {
    configKey: "syncKeyboard",
    handles: [MESSAGE_TYPES.KEY_EVENT],
    silent: false,

    capture() {
      const onKey = (event: KeyboardEvent) => {
        if (!event.isTrusted) return;

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
      if (message.subType === "keydown" || !syncKeyTarget) {
        const point = ratioToPoint(message.xRatio, message.yRatio);
        const fallback = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
        const element = elementAt(point.x, point.y, fallback);

        if (!element) return;
        syncKeyTarget = element;

        if (syncKeyTarget && "focus" in syncKeyTarget) syncKeyTarget.focus();
      }

      if (syncKeyTarget) {
        logger.execute(message.subType, `[${message.keyData.code}] on:`, syncKeyTarget);
        dispatchSyntheticKeyboardEvent(syncKeyTarget, message.subType, message.keyData);
      }

      if (message.subType !== "keyup") return;

      syncKeyTarget = null;
    }
  };
}