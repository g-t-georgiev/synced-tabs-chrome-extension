import type { Feature, MessageController, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  fieldRect,
  fingerprint,
  isFromOwnUi,
  isValueField,
  setNativeValue,
  type FieldFingerprint,
  type FieldRect,
} from "../dom";
import { findIdenticalField, isFound } from "./field-match";

type TextSyncKey = Extract<StateConfigKey, "syncText">;
interface TextSyncPayload {
  type: string;
  /** The field event mirrored: `input` while editing, `change` when committed. */
  subType: string;
  value: string;
  /** The field's box in the sender's viewport, px. */
  rect: FieldRect;
  fingerprint: FieldFingerprint;
  /**
   * The sender's `InputEvent` details (`insertText`, `insertFromPaste`,
   * `deleteContentBackward`, …). Absent when its `input` event wasn't an `InputEvent`
   * (a `<select>`), for `change`, and in messages from older builds.
   */
  inputType?: string;
  data?: string | null;
}

const EVENT_TYPES = ["input", "change"] as const;

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
            ...(event instanceof InputEvent
              ? { inputType: event.inputType, data: event.data }
              : {}),
          },
          { report: "Text edits" },
        );
      };

      EVENT_TYPES.forEach((type) => window.addEventListener(type, onFieldEvent, true));
      return () =>
        EVENT_TYPES.forEach((type) => window.removeEventListener(type, onFieldEvent, true));
    },

    apply(message) {
      const field = findIdenticalField(message);
      if (!isFound(field)) return field;

      if (field.value !== message.value) setNativeValue(field, message.value);
      field.dispatchEvent(fieldEvent(message, field));
    },
  };
}

/**
 * The event the sender's field fired, as the browser would fire it: edits of text fields are
 * `InputEvent`s carrying `inputType` and `data`, which page code may read; `<select>` input
 * and `change` are plain events, and `change` doesn't cross shadow roots.
 */
function fieldEvent(message: TextSyncPayload, field: Element): Event {
  if (message.subType === "change") return new Event("change", { bubbles: true });

  // Older builds didn't send `inputType`: assume typing unless it's a <select>.
  const isInputEvent = message.inputType !== undefined || !(field instanceof HTMLSelectElement);
  if (!isInputEvent) return new Event("input", { bubbles: true, composed: true });

  return new InputEvent("input", {
    bubbles: true,
    composed: true,
    inputType: message.inputType ?? "insertText",
    data: message.data ?? null,
  });
}
