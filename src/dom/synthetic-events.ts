import type { KeyboardEventData } from "../shared/types";

export interface PointerButtons {
  /** Button that changed state (`MouseEvent.button`): 0 primary, 1 middle, 2 secondary. */
  button: number;
  /** Bitmask of buttons held after the event (`MouseEvent.buttons`). */
  buttons: number;
}

/** Mouse events a browser fires after the matching pointer event, for older listeners. */
const COMPAT_MOUSE_EVENTS: Partial<Record<string, string>> = {
  pointerdown: "mousedown",
  pointerup: "mouseup",
};

/** Elements that take focus when pressed, as in the browser's mousedown default action. */
const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[tabindex]",
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(",");

/**
 * `preventDefault()` on pointerdown suppresses the compatibility mouse events up to and
 * including the next pointerup (the click itself still fires). One pointer, so one flag.
 */
let compatSuppressed = false;

/**
 * Dispatches one mirrored pointer event (`pointerdown`, `pointerup` or `click`) the way
 * Chrome fires it for a primary mouse button, followed by its compatibility mouse event.
 * Pointerdown also moves focus like a real press does.
 */
export function dispatchSyntheticPointerEvent(
  element: Element,
  type: string,
  x: number,
  y: number,
  { button, buttons }: PointerButtons,
) {
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    button,
    buttons,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: buttons ? 0.5 : 0,
    // Click count: 1 for click, 0 for the pointer down/up events themselves.
    detail: type === "click" ? 1 : 0,
  };

  const proceed = element.dispatchEvent(new PointerEvent(type, init));
  if (type === "pointerdown") compatSuppressed = !proceed;

  const compat = COMPAT_MOUSE_EVENTS[type];
  let mouseProceed = true;
  if (compat && !compatSuppressed) {
    mouseProceed = element.dispatchEvent(new MouseEvent(compat, { ...init, detail: 1 }));
  }

  // Focus is the press's default action: it runs after mousedown listeners, and only
  // cancelling mousedown prevents it (cancelling pointerdown does not).
  if (type === "pointerdown" && mouseProceed) focusLikeNative(element);

  if (type === "pointerup") compatSuppressed = false;
}

/**
 * Focuses the nearest focusable ancestor of the pressed element; pressing anywhere else
 * blurs the focused element, as clicking empty page space does.
 */
function focusLikeNative(element: Element) {
  const target = element.closest(FOCUSABLE);

  if (target instanceof HTMLElement || target instanceof SVGElement) {
    target.focus({ preventScroll: true });
    return;
  }

  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) active.blur();
}

export function dispatchSyntheticKeyboardEvent(
  element: Element,
  type: string,
  data: KeyboardEventInit,
) {
  if (!element) return;
  const event = new KeyboardEvent(type, data);
  element.dispatchEvent(event);
}

export function buildKeyboardEventData(event: KeyboardEvent): KeyboardEventData {
  return {
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    which: event.which,
    charCode: event.charCode,
    bubbles: true,
    cancelable: true,
    composed: true,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
  };
}
