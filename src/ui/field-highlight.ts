import {
  OWN_UI_ATTR,
  isSelectableField,
  selectionRects,
  type LocalRect,
  type SelectableField,
} from "../dom";

export interface FieldHighlight {
  /** Outlines `field` and keeps the outline on it until {@link hide}. Clears any selection. */
  show(field: Element): void;
  /**
   * Draws the selection `start`…`end` of the outlined field (a caret when empty), and keeps
   * it in place as the field's text, scroll position or box changes. Cleared by {@link show}
   * of another field and by {@link hide}.
   */
  select(start: number, end: number): void;
  hide(): void;
  /** The field currently outlined, if any. */
  readonly field: Element | null;
}

/** Gap between the field's border and the outline, px (equal to the outline's width). */
const GAP = 2;
const SELECTION_COLOR = "rgba(0, 255, 255, 0.3)";
const CARET_COLOR = "#00ffff";

/**
 * A ghost focus ring, selection and caret: Chrome paints focus and selection only in the
 * window that has OS focus, so the extension draws its own over the mirrored field in other
 * windows, styled like the ghost cursor. It follows the field each frame (scrolling,
 * resizing, layout changes) and disappears when the field leaves the page.
 */
export function createFieldHighlight({
  measure = selectionRects,
}: {
  /** Where a range of the field's text is drawn (overridable for tests). */
  measure?: (field: SelectableField, start: number, end: number) => LocalRect[];
} = {}): FieldHighlight {
  let host: HTMLElement | null = null;
  let layer: HTMLElement | null = null;
  let field: Element | null = null;
  let selection: { start: number; end: number } | null = null;
  let frame = 0;
  let lastBox = "";
  let lastSelection = "";

  function ensureHost() {
    if (host) return host;
    host = document.createElement("div");
    host.setAttribute(OWN_UI_ATTR, "");
    host.style.cssText = [
      "position: fixed",
      "top: 0",
      "left: 0",
      "z-index: 2147483646", // just under the ghost cursor
      "pointer-events: none",
      "box-sizing: border-box",
      "border: 2px solid #00ffff",
      "border-radius: 4px",
      "box-shadow: 0 0 8px rgba(0, 255, 255, 0.8)",
      "display: none",
    ].join("; ");
    // Inside the 2px border, so the layer's origin is the field's top-left corner.
    layer = document.createElement("div");
    layer.style.cssText = "position: absolute; left: 0; top: 0; overflow: hidden";
    host.append(layer);
    return host;
  }

  function drawSelection(width: number, height: number) {
    if (!layer) return;
    const target = field;
    if (!selection || !isSelectableField(target)) {
      if (lastSelection) layer.replaceChildren();
      lastSelection = "";
      return;
    }

    const key = [
      selection.start,
      selection.end,
      target.scrollLeft,
      target.scrollTop,
      width,
      height,
      target.value,
    ].join("\u0000");
    if (key === lastSelection) return;
    lastSelection = key;

    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    const caret = selection.start === selection.end;
    layer.replaceChildren(
      ...measure(target, selection.start, selection.end).map((rect) => {
        const box = document.createElement("div");
        box.style.cssText = [
          "position: absolute",
          `left: ${rect.left}px`,
          `top: ${rect.top}px`,
          `width: ${rect.width}px`,
          `height: ${rect.height}px`,
          `background: ${caret ? CARET_COLOR : SELECTION_COLOR}`,
        ].join("; ");
        return box;
      }),
    );
  }

  function place() {
    if (!field || !host) return;

    if (!field.isConnected) {
      hide();
      return;
    }

    const { left, top, width, height } = field.getBoundingClientRect();
    const visible = width > 0 && height > 0;
    const next = visible ? `${left},${top},${width},${height}` : "hidden";

    // Only touch styles when something changed, so an idle ring costs a rect read per frame.
    if (next !== lastBox) {
      lastBox = next;
      host.style.display = visible ? "block" : "none";
      if (visible) {
        host.style.transform = `translate(${left - GAP}px, ${top - GAP}px)`;
        host.style.width = `${width + GAP * 2}px`;
        host.style.height = `${height + GAP * 2}px`;
      }
    }
    if (visible) drawSelection(width, height);

    frame = requestAnimationFrame(place);
  }

  function clearSelection() {
    selection = null;
    lastSelection = "";
    layer?.replaceChildren();
  }

  function hide() {
    cancelAnimationFrame(frame);
    frame = 0;
    field = null;
    lastBox = "";
    clearSelection();
    if (host) host.style.display = "none";
  }

  return {
    show(target) {
      cancelAnimationFrame(frame);
      if (target !== field) clearSelection();
      field = target;
      lastBox = "";
      const ring = ensureHost();
      if (!ring.isConnected) (document.body ?? document.documentElement).append(ring);
      place();
    },
    select(start, end) {
      if (!field) return;
      selection = { start, end };
      lastSelection = "";
      cancelAnimationFrame(frame);
      place();
    },
    hide,
    get field() {
      return field;
    },
  };
}
