import type { Feature, MessageController, StateConfigKey } from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import {
  fieldRect,
  fingerprint,
  isOwnUi,
  isSelectableField,
  rAfThrottle,
  type FieldFingerprint,
  type FieldRect,
  type SelectableField,
} from "../dom";
import type { FieldHighlight } from "../ui/field-highlight";
import { findIdenticalField, isFound } from "./field-match";

type TextSelectionKey = Extract<StateConfigKey, "syncText">;
interface TextSelectionPayload {
  type: string;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
  rect: FieldRect;
  fingerprint: FieldFingerprint;
}

/** The focused element, looking inside open shadow roots. */
function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

const selectionKey = (start: number, end: number, direction: string) =>
  `${start},${end},${direction}`;

/**
 * Mirrors the selection and caret of the focused text field (mouse selection, Shift+arrows,
 * Ctrl+A, the caret moving while typing). Synthetic keys don't select, and background
 * windows don't paint a selection, so receivers both set the range on their identical field
 * (later edits then apply to the same range) and draw it with the ghost highlight.
 *
 * Part of text sync: on and off with the "Text Fields" toggle. Inputs without a selection
 * API (number, email, …) and password fields are skipped.
 */
export function createTextSelectionSync({
  transport,
  highlight,
}: {
  transport: MessageController;
  highlight: FieldHighlight;
}): Feature<TextSelectionKey, TextSelectionPayload> {
  /**
   * Ranges this tab set from a remote message, per field. Setting a range fires a (trusted)
   * `selectionchange` too; seeing the same range once means it's that echo, not the user.
   */
  const applied: WeakMap<SelectableField, string> = new WeakMap();

  return {
    configKey: "syncText",
    handles: [MESSAGE_TYPES.TEXT_SELECTION],
    // Selections change on every caret move: no badge flash or pulse.
    silent: true,

    capture() {
      let lastField: SelectableField | null = null;
      let lastKey = "";

      // At most one message per frame, with the latest range.
      const send = rAfThrottle(() => {
        const field = deepActiveElement();
        if (!isSelectableField(field) || isOwnUi(field)) return;

        const { selectionStart: start, selectionEnd: end } = field;
        if (start === null || end === null) return;
        const direction = field.selectionDirection ?? "none";
        const key = selectionKey(start, end, direction);

        if (applied.get(field) === key) {
          applied.delete(field); // our own range, set from another tab
          return;
        }
        if (field === lastField && key === lastKey) return;
        lastField = field;
        lastKey = key;

        transport.broadcast({
          type: MESSAGE_TYPES.TEXT_SELECTION,
          start,
          end,
          direction,
          rect: fieldRect(field),
          fingerprint: fingerprint(field),
        });
      });

      const onSelectionChange = () => send();
      // Focusing a field again sends its range again, even if unchanged.
      const onFocus = () => {
        lastField = null;
        lastKey = "";
      };

      // Capture on document: `selectionchange` for inputs is fired at the input and doesn't
      // bubble; `select` covers text selected inside inputs in older engines.
      document.addEventListener("selectionchange", onSelectionChange, true);
      window.addEventListener("select", onSelectionChange, true);
      window.addEventListener("focusin", onFocus, true);
      return () => {
        document.removeEventListener("selectionchange", onSelectionChange, true);
        window.removeEventListener("select", onSelectionChange, true);
        window.removeEventListener("focusin", onFocus, true);
        send.cancel();
      };
    },

    apply(message) {
      const field = findIdenticalField(message);
      if (!isFound(field)) return field;
      if (!isSelectableField(field)) return;

      const length = field.value.length;
      const start = Math.max(0, Math.min(message.start, length));
      const end = Math.max(start, Math.min(message.end, length));
      applied.set(field, selectionKey(start, end, message.direction));
      try {
        field.setSelectionRange(start, end, message.direction);
      } catch {
        // Not every field accepts a range at every moment; the drawing still shows it.
      }

      if (highlight.field !== field) highlight.show(field);
      highlight.select(start, end);
    },
  };
}
