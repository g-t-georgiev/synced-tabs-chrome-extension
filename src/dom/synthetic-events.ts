import type { KeyboardEventData } from "../shared/types";

export function isPointerEventSupported() {
  return "PointerEvent" in window;
}

export function dispatchSyntheticPointerEvent(
  element: Element,
  x: number,
  y: number,
  specificType: string,
) {
  if (!element) return;

  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
  };

  const hasPESupport = isPointerEventSupported();
  const EventCtor = hasPESupport ? window.PointerEvent : window.MouseEvent;

  if (specificType) {
    element.dispatchEvent(new EventCtor(specificType, eventInit));
  } else {
    element.dispatchEvent(new EventCtor(hasPESupport ? "pointerdown" : "mousedown", eventInit));
    element.dispatchEvent(new EventCtor(hasPESupport ? "pointerup" : "mouseup", eventInit));
    element.dispatchEvent(new MouseEvent("click", eventInit));
  }

  // Focus handling is reworked in step 4; keep today's behaviour for HTML and SVG targets.
  if (element instanceof HTMLElement || element instanceof SVGElement) element.focus();
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
