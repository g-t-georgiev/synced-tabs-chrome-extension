export function isPointerEventSupported() {
  return "PointerEvent" in window;
}

/**
 * @param {Element} element
 * @param {number} x
 * @param {number} y
 * @param {string} specificType
 */
export function dispatchSyntheticPointerEvent(element, x, y, specificType) {
  if (!element) return;

  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY
  };

  const hasPESupport = isPointerEventSupported();
  const EventCtor = hasPESupport ? window.PointerEvent : window.MouseEvent;

  if (specificType) {
    element.dispatchEvent(new EventCtor(specificType, eventInit));
  } else {
    element.dispatchEvent(
      new EventCtor(hasPESupport ? "pointerdown" : "mousedown", eventInit)
    );
    element.dispatchEvent(
      new EventCtor(hasPESupport ? "pointerup" : "mouseup", eventInit)
    );
    element.dispatchEvent(new MouseEvent("click", eventInit));
  }

  if (typeof element.focus === "function") element.focus();
}

/**
 * @param {Element} element
 * @param {string} type
 * @param {KeyboardEventInit} [data] 
 */
export function dispatchSyntheticKeyboardEvent(element, type, data) {
  if (!element) return;
  const event = new KeyboardEvent(type, data);
  element.dispatchEvent(event);
}

/** 
 * @typedef {Pick<
 *  KeyboardEvent, 
 *  | "key"
 *  | "code" 
 *  | "keyCode"
 *  | "which"
 *  | "charCode"
 *  | "bubbles"
 *  | "cancelable"
 *  | "composed"
 *  | "altKey"
 *  | "ctrlKey"
 *  | "shiftKey"
 *  | "metaKey"
 *  | "repeat"
 * >} KeyboardEventData
 */

/**
 * @param {KeyboardEvent} event
 * @returns {KeyboardEventData}
 */
export function buildKeyboardEventData(event) {
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
    repeat: event.repeat
  };
}