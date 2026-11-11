import type { ApplyResult, Feature, MessageController, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  elementAt,
  fieldRect,
  fingerprint,
  isFromOwnUi,
  isValueField,
  sameField,
  sameRect,
  setNativeValue,
  viewportMatches,
  viewportMismatch,
  type FieldFingerprint,
  type FieldRect,
} from "../dom";

type TextSyncKey = Extract<StateConfigKey, "syncText">;
interface TextSyncPayload {
  type: string;
  /** The field event mirrored: `input` while editing, `change` when committed. */
  subType: string;
  value: string;
  /** The field's box in the sender's viewport, px. */
  rect: FieldRect;
  fingerprint: FieldFingerprint;
}

const EVENT_TYPES = ["input", "change"] as const;
const FIELD_MISMATCH: ApplyResult = { status: "dropped", reason: "field-mismatch" };

/**
 * Mirrors what's in text fields (typing, paste, cut, delete, autofill, undo) by value
 * rather than by keystrokes, which can't insert text. Password fields are never sent.
 *
 * A receiver writes the value only into an identical field at the same place: same window
 * size, a field on top at the sender field's centre, the same box within 1px, and the same
 * tag, type, id, name, placeholder, aria-label and classes. Anything else is dropped and
 * reported to the sender.
 *
 * The receiver fires the same event the sender's field did: `input` for edits (React's
 * `onChange`), `change` for commits (Tweakpane updates its binding on `change`).
 */
export function createTextSync({
  transport,
}: {
  transport: MessageController;
}): Feature<TextSyncKey, TextSyncPayload> {
  return {
    configKey: "syncText",
    handles: [MESSAGE_TYPES.TEXT_INPUT],
    silent: false,

    capture() {
      const onFieldEvent = (event: Event) => {
        if (!event.isTrusted || isFromOwnUi(event)) return;
        // The innermost target, so fields inside open shadow roots are found too.
        const field = event.composedPath()[0];
        if (!isValueField(field)) return;

        transport.broadcast(
          {
            type: MESSAGE_TYPES.TEXT_INPUT,
            subType: event.type,
            value: field.value,
            rect: fieldRect(field),
            fingerprint: fingerprint(field),
          },
          { report: "Text edits" },
        );
      };

      EVENT_TYPES.forEach((type) => window.addEventListener(type, onFieldEvent, true));
      return () =>
        EVENT_TYPES.forEach((type) => window.removeEventListener(type, onFieldEvent, true));
    },

    apply(message) {
      if (!viewportMatches(message.viewport)) return viewportMismatch();

      const { rect } = message;
      const field = elementAt(rect.left + rect.width / 2, rect.top + rect.height / 2);

      if (
        !isValueField(field) ||
        !sameRect(fieldRect(field), rect) ||
        !sameField(fingerprint(field), message.fingerprint)
      ) {
        return FIELD_MISMATCH;
      }

      if (field.value !== message.value) setNativeValue(field, message.value);
      field.dispatchEvent(
        new Event(message.subType === "change" ? "change" : "input", { bubbles: true }),
      );
    },
  };
}
