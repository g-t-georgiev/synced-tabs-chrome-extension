/** A form field whose content is its `value`. */
export type ValueField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** What identifies a field across tabs. Attributes absent on an element are `null`. */
export interface FieldFingerprint {
  tag: string;
  type: string | null;
  id: string | null;
  name: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  /** Sorted, so class order doesn't matter. */
  classes: string[];
}

/** A field's box in viewport px. */
export interface FieldRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Inputs whose content isn't a typed value (toggled or clicked: mouse sync covers those),
 * or must never leave the tab (passwords).
 */
const EXCLUDED_INPUT_TYPES = new Set([
  "password",
  "checkbox",
  "radio",
  "file",
  "button",
  "submit",
  "reset",
  "image",
  "hidden",
]);

/** Whether text sync mirrors this element's value. Password fields never are. */
export function isValueField(el: EventTarget | null | undefined): el is ValueField {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && !EXCLUDED_INPUT_TYPES.has(el.type);
}

export function fingerprint(el: Element): FieldFingerprint {
  return {
    tag: el.tagName,
    type: el.getAttribute("type"),
    id: el.id || null,
    name: el.getAttribute("name"),
    placeholder: el.getAttribute("placeholder"),
    ariaLabel: el.getAttribute("aria-label"),
    classes: [...el.classList].sort(),
  };
}

export function sameField(a: FieldFingerprint, b: FieldFingerprint): boolean {
  return (
    a.tag === b.tag &&
    a.type === b.type &&
    a.id === b.id &&
    a.name === b.name &&
    a.placeholder === b.placeholder &&
    a.ariaLabel === b.ariaLabel &&
    a.classes.length === b.classes.length &&
    a.classes.every((cls, index) => cls === b.classes[index])
  );
}

export function fieldRect(el: Element): FieldRect {
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
}

/** Whether two boxes match within `tolerance` px on every edge and dimension. */
export function sameRect(a: FieldRect, b: FieldRect, tolerance = 1): boolean {
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

/**
 * Sets a field's value the way user input does, so frameworks notice it: React tracks the
 * last value it wrote through an instance-level `value` property, and only reports a
 * change when the value it sees differs, so the prototype's setter has to be used.
 */
export function setNativeValue(el: ValueField, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}
