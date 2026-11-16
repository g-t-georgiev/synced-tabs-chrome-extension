import type { Feature, MessageController, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  fieldRect,
  fingerprint,
  isFromOwnUi,
  isValueField,
  type FieldFingerprint,
  type FieldRect,
} from "../dom";
import type { FieldHighlight } from "../ui/field-highlight";
import { findIdenticalField, isFound } from "./field-match";

type TextFocusKey = Extract<StateConfigKey, "syncText">;
interface TextFocusPayload {
  type: string;
  state: string;
  rect: FieldRect;
  fingerprint: FieldFingerprint;
}

const EVENT_STATES = { focusin: "focus", focusout: "blur" } as const;

/**
 * Shows which field is being edited in the other windows. Chrome draws the focus ring, caret
 * and selection only in the window with OS focus, so while a text field is focused here,
 * receivers outline their identical field (same match as text sync) with a ghost ring.
 *
 * Part of text sync: on and off with the "Text Fields" toggle. Focusing something in the
 * receiving tab itself removes its ring.
 */
export function createTextFocusSync({
  transport,
  highlight,
}: {
  transport: MessageController;
  highlight: FieldHighlight;
}): Feature<TextFocusKey, TextFocusPayload> {
  return {
    configKey: "syncText",
    handles: [MESSAGE_TYPES.TEXT_FOCUS],
    // A focus change isn't an applied edit: no badge flash or pulse.
    silent: true,

    capture() {
      const onFocusChange = (event: FocusEvent) => {
        if (!event.isTrusted || isFromOwnUi(event)) return;

        // Chrome reports focus moved by code (a mirrored click's focus()) as trusted too, so
        // only the tab the user is working in counts. Its native ring takes over from ours.
        // Blur is sent regardless: it only removes rings (e.g. when this window is minimized).
        const focused = document.hasFocus();
        if (event.type === "focusin") {
          if (!focused) return;
          highlight.hide();
        }

        const field = event.composedPath()[0];
        if (!isValueField(field)) return;

        transport.broadcast({
          type: MESSAGE_TYPES.TEXT_FOCUS,
          state: EVENT_STATES[event.type as keyof typeof EVENT_STATES],
          rect: fieldRect(field),
          fingerprint: fingerprint(field),
        });
      };

      window.addEventListener("focusin", onFocusChange, true);
      window.addEventListener("focusout", onFocusChange, true);
      return () => {
        window.removeEventListener("focusin", onFocusChange, true);
        window.removeEventListener("focusout", onFocusChange, true);
        highlight.hide();
      };
    },

    apply(message) {
      // A blur clears the ring even if the field has moved since it was focused. And the tab
      // the user is working in shows only the browser's own focus ring, never ours.
      if (message.state !== "focus" || document.hasFocus()) {
        highlight.hide();
        return;
      }

      const field = findIdenticalField(message);
      if (!isFound(field)) {
        highlight.hide();
        return field;
      }

      highlight.show(field);
    },
  };
}
