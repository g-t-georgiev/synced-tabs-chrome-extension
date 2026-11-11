import { OWN_UI_ATTR } from "../dom";

export interface FieldHighlight {
  /** Outlines `field` and keeps the outline on it until {@link hide}. */
  show(field: Element): void;
  hide(): void;
  /** The field currently outlined, if any. */
  readonly field: Element | null;
}

/** Gap between the field's border and the outline, px. */
const GAP = 2;

/**
 * A ghost focus ring: Chrome paints focus only in the window that has OS focus, so the
 * extension draws its own outline over the mirrored field in other windows, styled like
 * the ghost cursor. It follows the field each frame (scrolling, resizing, layout changes)
 * and disappears when the field leaves the page.
 */
export function createFieldHighlight(): FieldHighlight {
  let host: HTMLElement | null = null;
  let field: Element | null = null;
  let frame = 0;
  let last = "";

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
    return host;
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

    // Only touch styles when the box changed, so an idle ring costs one rect read per frame.
    if (next !== last) {
      last = next;
      host.style.display = visible ? "block" : "none";
      if (visible) {
        host.style.transform = `translate(${left - GAP}px, ${top - GAP}px)`;
        host.style.width = `${width + GAP * 2}px`;
        host.style.height = `${height + GAP * 2}px`;
      }
    }

    frame = requestAnimationFrame(place);
  }

  function hide() {
    cancelAnimationFrame(frame);
    frame = 0;
    field = null;
    last = "";
    if (host) host.style.display = "none";
  }

  return {
    show(target) {
      cancelAnimationFrame(frame);
      field = target;
      last = "";
      const ring = ensureHost();
      if (!ring.isConnected) (document.body ?? document.documentElement).append(ring);
      place();
    },
    hide,
    get field() {
      return field;
    },
  };
}
