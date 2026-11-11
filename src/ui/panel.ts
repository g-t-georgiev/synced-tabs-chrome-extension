import type {
  PanelController,
  PanelDragListener,
  PanelPosition,
  StateConfig,
  StateStore,
} from "../shared/types";
import { OWN_UI_ATTR } from "../dom";
import { createPanelUICSS, createPanelUIHTML } from "./panel-template";

const PULSE_MS = 150;
const BADGE_FLASH_MS = 200;

export function createPanel({
  windowId,
  config,
}: {
  windowId: string;
  config: StateStore<StateConfig>;
}): PanelController {
  let host: HTMLElement,
    mouseToggle: HTMLInputElement,
    scrollToggle: HTMLInputElement,
    keyToggle: HTMLInputElement,
    cursorToggle: HTMLInputElement,
    badge: HTMLElement,
    grabHandle: HTMLElement,
    dragging = false,
    panelBounds: DOMRect,
    grabHandleBounds: DOMRect,
    grabOffsetTop = 0,
    grabOffsetLeft = 0,
    grabInsetTop = 0,
    grabInsetLeft = 0;

  const dragListeners: Set<PanelDragListener> = new Set();

  // BUILD IN-PAGE CONTROL PANEL
  host = document.createElement("div");
  host.id = "mirror-sync-panel";
  host.setAttribute(OWN_UI_ATTR, "");
  const shadow = host.attachShadow({ mode: "open" });
  const styles = createPanelUICSS();
  const html = createPanelUIHTML({ windowId, config });

  shadow.innerHTML = styles + html;

  // Bind checkbox handlers to update chrome.storage
  mouseToggle = shadow.querySelector('[id^="sync-mouse-toggle"]')!;
  scrollToggle = shadow.querySelector('[id^="sync-scroll-toggle"]')!;
  keyToggle = shadow.querySelector('[id^="sync-key-toggle"]')!;
  cursorToggle = shadow.querySelector('[id^="sync-cursor-toggle"]')!;
  badge = shadow.querySelector("#sync-extension-badge")!;
  grabHandle = shadow.querySelector(".drag-handle")!;

  config.subscribe(updateUIControls);

  // Attach to DOM tree and initialize
  if (document.body) init();
  else window.addEventListener("DOMContentLoaded", () => init(), { once: true });

  // A function declaration, so it exists when `init()` runs straight away (the script was
  // injected into a page whose <body> already exists).
  function onChange(key: keyof StateConfig) {
    return function (ev: Event) {
      const target = ev.target as HTMLInputElement;
      const value = target.checked;
      config.set(key, value).catch(() => {});
    };
  }

  function init() {
    document.body.append(host);

    // Handle localStorage changes
    mouseToggle.addEventListener("change", onChange("syncMouse"));
    scrollToggle.addEventListener("change", onChange("syncScroll"));
    keyToggle.addEventListener("change", onChange("syncKeyboard"));
    cursorToggle.addEventListener("change", onChange("syncCursor"));

    // Init dragging logic
    grabHandle.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (dragging || ev.target !== grabHandle) return;

      dragging = true;

      if (ev.pointerId) host.setPointerCapture(ev.pointerId);

      grabHandle.style.setProperty("cursor", "grabbing");

      // get bounding rects
      panelBounds = host.getBoundingClientRect();
      grabHandleBounds = grabHandle.getBoundingClientRect();

      // click point within the handle
      grabOffsetTop = ev.clientY - grabHandleBounds.top;
      grabOffsetLeft = ev.clientX - grabHandleBounds.left;

      // handle origin relative to panel origin (includes translate(-50%, -50%))
      grabInsetTop = grabHandleBounds.top - panelBounds.top;
      grabInsetLeft = grabHandleBounds.left - panelBounds.left;

      window.addEventListener("pointerup", dragEndedHandler);
      window.addEventListener("pointercancel", dragEndedHandler);
      window.addEventListener("pointermove", draggingHandler);

      emitDrag("start", { x: ev.clientX, y: ev.clientY });
    });
  }

  function getPosition(): PanelPosition {
    const { left, top } = host.getBoundingClientRect();
    return { left, top };
  }

  function emitDrag(phase: Parameters<PanelDragListener>[0], point: { x: number; y: number }) {
    const position = getPosition();
    dragListeners.forEach((listener) => listener(phase, position, point));
  }

  /**
   * Keeps the panel inside the viewport: the drag handle (which sticks out top-left by
   * `inset`) stays on screen, and so does the panel's bottom-right corner.
   */
  function clampPosition(
    top: number,
    left: number,
    bounds: Pick<DOMRect, "width" | "height">,
    insetTop: number,
    insetLeft: number,
  ): PanelPosition {
    return {
      top: Math.min(Math.max(top, -insetTop), window.innerHeight - bounds.height),
      left: Math.min(Math.max(left, -insetLeft), window.innerWidth - bounds.width),
    };
  }

  function placeAt({ top, left }: PanelPosition) {
    host.style.setProperty("top", `${top}px`);
    host.style.setProperty("left", `${left}px`);
    host.style.setProperty("right", "auto"); // By default "right" is used in CSS, must override with "auto"
  }

  /** Updates UI state. */
  function updateUIControls() {
    if (mouseToggle) mouseToggle.checked = config.state.syncMouse;
    if (keyToggle) keyToggle.checked = config.state.syncKeyboard;
    if (scrollToggle) scrollToggle.checked = config.state.syncScroll;
    if (cursorToggle) cursorToggle.checked = config.state.syncCursor;
  }
  /** Handles dragging. */
  function draggingHandler(ev: PointerEvent) {
    if (!dragging) return;

    const top = ev.clientY - grabOffsetTop - grabInsetTop;
    const left = ev.clientX - grabOffsetLeft - grabInsetLeft;

    placeAt(clampPosition(top, left, panelBounds, grabInsetTop, grabInsetLeft));
    emitDrag("move", { x: ev.clientX, y: ev.clientY });
  }
  /** Handles dragging end. */
  function dragEndedHandler(ev: PointerEvent) {
    if (!dragging) return;

    dragging = false;

    grabHandle.style.removeProperty("cursor");

    window.removeEventListener("pointerup", dragEndedHandler);
    window.removeEventListener("pointercancel", dragEndedHandler);
    window.removeEventListener("pointermove", draggingHandler);

    emitDrag("end", { x: ev.clientX, y: ev.clientY });
  }

  return {
    /** What part of this panel is at a viewport point, if any. */
    hitTest(x, y) {
      const element = shadow.elementFromPoint(x, y);
      // Outside the shadow tree means the point is not on this panel.
      if (!element || (element !== host && !shadow.contains(element))) return null;
      if (element === grabHandle) return "handle";
      if (element.closest(".toggle-switch")) return "toggle";
      return "body";
    },
    getPosition,
    /** Moves the panel, clamped to this viewport like a local drag. */
    setPosition(position) {
      const bounds = host.getBoundingClientRect();
      const handle = grabHandle.getBoundingClientRect();
      placeAt(
        clampPosition(
          position.top,
          position.left,
          bounds,
          handle.top - bounds.top,
          handle.left - bounds.left,
        ),
      );
    },
    onDrag(listener) {
      dragListeners.add(listener);
      return () => dragListeners.delete(listener);
    },
    /** Flash badge blue when receiving remote event. Reset styles after {@link BADGE_FLASH_MS} */
    flash() {
      if (!badge) return;
      badge.style.setProperty("background", "cyan");
      badge.style.setProperty("color", "#000");
      setTimeout(() => {
        badge.style.removeProperty("background");
        badge.style.removeProperty("color");
      }, BADGE_FLASH_MS);
    },
    /** Pulsing effect on when receiving remote event. Reset styles after {@link PULSE_MS} */
    pulse() {
      if (!host) return;
      host.classList.add("receiving");
      setTimeout(() => host.classList.remove("receiving"), PULSE_MS);
    },
  };
}
