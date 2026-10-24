import type { StateConfig, StateStore, UIController } from "../shared/types";
import { createPanelUICSS, createPanelUIHTML } from "./panel-template";

const PULSE_MS = 150;
const BADGE_FLASH_MS = 200;

export function createPanel({ windowId, config }: { windowId: string; config: StateStore<StateConfig>}): UIController {
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

  // BUILD IN-PAGE CONTROL PANEL
  host = document.createElement("div");
  host.id = "mirror-sync-panel";
  const shadow = host.attachShadow({ mode: "open" });
  const styles = createPanelUICSS();
  const html = createPanelUIHTML({ windowId, config });

  shadow.innerHTML = styles + html;

  // Bind checkbox handlers to update chrome.storage
  mouseToggle = shadow.querySelector("[id^=\"sync-mouse-toggle\"]")!;
  scrollToggle = shadow.querySelector("[id^=\"sync-scroll-toggle\"]")!;
  keyToggle = shadow.querySelector("[id^=\"sync-key-toggle\"]")!;
  cursorToggle = shadow.querySelector("[id^=\"sync-cursor-toggle\"]")!;
  badge = shadow.querySelector("#sync-extension-badge")!;
  grabHandle = shadow.querySelector(".drag-handle")!;

  config.subscribe(updateUIControls);

  // Attach to DOM tree and initialize
  if (document.body) init();
  else window.addEventListener("DOMContentLoaded", () => init(), { once: true });

  const onChange = function (key: keyof StateConfig) {
    return function (ev: Event) {
      const target = ev.target as HTMLInputElement;
      const value = target.checked;
      config.set(key, value);
    };
  };

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
    });
  };

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

    let offsetX = ev.clientX - grabOffsetLeft;
    let offsetY = ev.clientY - grabOffsetTop;

    let top = offsetY - grabInsetTop;
    let left = offsetX - grabInsetLeft;

    // handle top/left >= 0  →  panel >= -inset
    const minTop = -grabInsetTop;   // ≈ 5
    const minLeft = -grabInsetLeft; // ≈ 5

    const maxTop = window.innerHeight - panelBounds.height;
    const maxLeft = window.innerWidth - panelBounds.width;

    top = Math.min(Math.max(top, minTop), maxTop);
    left = Math.min(Math.max(left, minLeft), maxLeft);

    host.style.setProperty("top", `${top}px`);
    host.style.setProperty("left", `${left}px`);
    host.style.setProperty("right", "auto"); // By default "right" is used in CSS, must override with "auto"
  };
  /** Handles dragging end. */
  function dragEndedHandler(ev: PointerEvent) {
    if (!dragging) return;

    dragging = false;

    grabHandle.style.removeProperty("cursor");

    window.removeEventListener("pointerup", dragEndedHandler);
    window.removeEventListener("pointercancel", dragEndedHandler);
    window.removeEventListener("pointermove", draggingHandler);
  };

  return {
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
    }
  }
}