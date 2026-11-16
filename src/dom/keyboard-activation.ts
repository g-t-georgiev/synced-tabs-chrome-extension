import type { KeyboardEventData } from "../shared/types";

/**
 * Synthetic key events have no default actions, so a mirrored Enter or Space would do
 * nothing where the real one presses a button or submits a form. These are the browser's
 * activation behaviours for those keys, performed by hand after a mirrored key the page didn't
 * cancel:
 *
 * | Key               | Target                                        | Action                     |
 * |-------------------|-----------------------------------------------|----------------------------|
 * | Enter (keydown)   | text-like `<input>` in a form                 | implicit submission        |
 * | Enter (keydown)   | `<button>`, `<a href>`, input submit/button/reset | `click()`              |
 * | Space (keyup)     | `<button>`, input checkbox/radio/submit/button/reset | `click()`           |
 *
 * Never in `<textarea>` (Enter inserts a line; text sync mirrors that), and only without
 * modifier keys. A synthetic `click()` runs the element's activation (pressing, toggling,
 * submitting, following a link) like a real one.
 */

/** Inputs Enter submits from: the ones that take typed text. */
const TEXT_LIKE_INPUTS = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

const BUTTON_INPUTS = new Set(["submit", "button", "reset", "image"]);
const SPACE_INPUTS = new Set(["checkbox", "radio", "submit", "button", "reset"]);

const isEnter = (key: KeyboardEventData) =>
  key.key === "Enter" || key.code === "Enter" || key.code === "NumpadEnter";
const isSpace = (key: KeyboardEventData) => key.key === " " || key.code === "Space";
const hasModifier = (key: KeyboardEventData) =>
  key.ctrlKey || key.altKey || key.metaKey || key.shiftKey;

function isDisabled(el: Element) {
  return (el as HTMLButtonElement).disabled === true || el.closest("fieldset[disabled]") !== null;
}

/** The form's default button: its first submit button, as the browser picks it. */
function defaultButton(form: HTMLFormElement): HTMLElement | null {
  for (const el of form.elements) {
    if (el instanceof HTMLButtonElement && el.type === "submit") return el;
    if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "image")) return el;
  }
  return null;
}

/** Enter in a text field: what the browser calls implicit submission. */
function submitImplicitly(input: HTMLInputElement): boolean {
  const form = input.form;
  if (!form) return false;

  const button = defaultButton(form);
  if (button) {
    // A disabled default button blocks submission rather than passing it on.
    if (isDisabled(button)) return false;
    button.click();
    return true;
  }

  // Without a submit button, only a form with a single text-like field submits.
  const blocking = [...form.elements].filter(
    (el) => el instanceof HTMLInputElement && TEXT_LIKE_INPUTS.has(el.type),
  );
  if (blocking.length !== 1) return false;
  form.requestSubmit();
  return true;
}

/**
 * Performs the default action of a mirrored key on `target`, if it has one. Call only when
 * the dispatched event wasn't cancelled. Returns whether something was done.
 */
export function performKeyDefault(target: Element, type: string, key: KeyboardEventData): boolean {
  if (hasModifier(key) || isDisabled(target)) return false;

  if (type === "keydown" && isEnter(key)) {
    if (target instanceof HTMLInputElement) {
      if (BUTTON_INPUTS.has(target.type)) {
        target.click();
        return true;
      }
      return TEXT_LIKE_INPUTS.has(target.type) && submitImplicitly(target);
    }
    if (
      target instanceof HTMLButtonElement ||
      (target instanceof HTMLAnchorElement && target.href)
    ) {
      target.click();
      return true;
    }
    return false;
  }

  if (type === "keyup" && isSpace(key)) {
    const activates =
      target instanceof HTMLButtonElement ||
      (target instanceof HTMLInputElement && SPACE_INPUTS.has(target.type));
    if (!activates) return false;
    (target as HTMLElement).click();
    return true;
  }

  return false;
}
