/** A box relative to a field's border box (its top-left corner is 0, 0), px. */
export interface LocalRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A text field whose selection can be read and set (`selectionStart` isn't `null`). */
export type SelectableField = HTMLInputElement | HTMLTextAreaElement;

/** Input types with a text selection API; others (number, email, …) report `null`. */
const SELECTABLE_INPUT_TYPES = new Set(["text", "search", "url", "tel"]);

export function isSelectableField(el: EventTarget | null | undefined): el is SelectableField {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && SELECTABLE_INPUT_TYPES.has(el.type);
}

/** Styles that decide where text sits inside a field; copied onto the measuring mirror. */
const TEXT_LAYOUT_PROPERTIES = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopStyle",
  "borderRightStyle",
  "borderBottomStyle",
  "borderLeftStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontKerning",
  "fontFeatureSettings",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "textAlign",
  "tabSize",
  "direction",
] as const;

/** A zero-width character, so a collapsed range (the caret) still has a box to measure. */
const CARET = "​";

/**
 * Boxes of the characters `start`…`end` of a text field's value, relative to the field's
 * border box and after its own scrolling, or one thin box for the caret when the range is
 * empty. Measured with a hidden "mirror" element that lays the text out like the field: same
 * font, spacing, padding, border and width; `pre` for inputs (one line), `pre-wrap` for
 * textareas (wrapped like the field).
 */
export function selectionRects(field: SelectableField, start: number, end: number): LocalRect[] {
  const style = getComputedStyle(field);
  const mirror = document.createElement("div");
  const mirrorStyle = mirror.style as unknown as Record<string, string>;
  for (const property of TEXT_LAYOUT_PROPERTIES) {
    mirrorStyle[property] = (style as unknown as Record<string, string>)[property] ?? "";
  }
  Object.assign(mirror.style, {
    position: "absolute",
    top: "0",
    left: "-99999px",
    visibility: "hidden",
    overflow: "hidden",
    borderColor: "transparent",
    whiteSpace: field instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
    overflowWrap: field instanceof HTMLTextAreaElement ? "break-word" : "normal",
  });

  const value = field.value;
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  const selected = document.createElement("span");
  selected.textContent = from === to ? CARET : value.slice(from, to);
  mirror.append(value.slice(0, from), selected, value.slice(to));

  (document.body ?? document.documentElement).append(mirror);
  try {
    const origin = mirror.getBoundingClientRect();
    const rects = [...selected.getClientRects()].map((rect) => ({
      left: rect.left - origin.left - field.scrollLeft,
      top: rect.top - origin.top - field.scrollTop,
      width: rect.width,
      height: rect.height,
    }));
    // The caret: a 2px line at the measured position.
    if (from === to) return rects.slice(0, 1).map((rect) => ({ ...rect, width: 2 }));
    return rects.filter((rect) => rect.width > 0);
  } finally {
    mirror.remove();
  }
}
