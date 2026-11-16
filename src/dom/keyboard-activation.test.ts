import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { KeyboardEventData } from "../shared/types";
import { performKeyDefault } from "./keyboard-activation";

function key(name: "Enter" | " ", modifiers: Partial<KeyboardEventData> = {}): KeyboardEventData {
  return {
    key: name,
    code: name === "Enter" ? "Enter" : "Space",
    keyCode: name === "Enter" ? 13 : 32,
    which: name === "Enter" ? 13 : 32,
    charCode: 0,
    bubbles: true,
    cancelable: true,
    composed: true,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    ...modifiers,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

function form(...children: Element[]) {
  const f = document.createElement("form");
  f.append(...children);
  document.body.append(f);
  // happy-dom would try to navigate; count submissions instead.
  const submitted = vi.spyOn(f, "requestSubmit").mockImplementation(() => {});
  return { form: f, submitted };
}

const input = (type: string) => {
  const i = document.createElement("input");
  i.type = type;
  return i;
};

describe("performKeyDefault", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe("Enter", () => {
    it("presses a focused button, link or button-like input", () => {
      for (const target of [
        el("button"),
        el("a", { href: "#somewhere" }),
        el("input", { type: "submit" }),
        el("input", { type: "button" }),
      ]) {
        const clicked = vi.fn();
        target.addEventListener("click", clicked);

        expect(performKeyDefault(target, "keydown", key("Enter"))).toBe(true);
        expect(clicked).toHaveBeenCalledOnce();
      }
    });

    it("leaves a link without href alone", () => {
      expect(performKeyDefault(el("a"), "keydown", key("Enter"))).toBe(false);
    });

    it("submits a form through its default button", () => {
      const field = input("text");
      const submit = document.createElement("button");
      const clicked = vi.fn((e: Event) => e.preventDefault());
      submit.addEventListener("click", clicked);
      form(field, submit);

      expect(performKeyDefault(field, "keydown", key("Enter"))).toBe(true);
      expect(clicked).toHaveBeenCalledOnce();
    });

    it("doesn't submit when the default button is disabled", () => {
      const field = input("text");
      const submit = document.createElement("button");
      submit.disabled = true;
      const { submitted } = form(field, submit);

      expect(performKeyDefault(field, "keydown", key("Enter"))).toBe(false);
      expect(submitted).not.toHaveBeenCalled();
    });

    it("submits a form without buttons only if it has a single text field", () => {
      const only = input("search");
      const single = form(only);
      expect(performKeyDefault(only, "keydown", key("Enter"))).toBe(true);
      expect(single.submitted).toHaveBeenCalledOnce();

      const first = input("text");
      const two = form(first, input("email"));
      expect(performKeyDefault(first, "keydown", key("Enter"))).toBe(false);
      expect(two.submitted).not.toHaveBeenCalled();
    });

    it("does nothing in a text field outside a form, or in a textarea", () => {
      expect(performKeyDefault(el("input", { type: "text" }), "keydown", key("Enter"))).toBe(false);
      const area = document.createElement("textarea");
      form(area);
      expect(performKeyDefault(area, "keydown", key("Enter"))).toBe(false);
    });

    it("acts on keydown only", () => {
      const button = el("button");
      expect(performKeyDefault(button, "keyup", key("Enter"))).toBe(false);
    });
  });

  describe("Space", () => {
    it("presses buttons and toggles checkboxes and radios on keyup", () => {
      const button = el("button");
      const checkbox = el("input", { type: "checkbox" });
      const radio = el("input", { type: "radio" });
      const clicked = vi.fn();
      button.addEventListener("click", clicked);

      expect(performKeyDefault(button, "keyup", key(" "))).toBe(true);
      expect(performKeyDefault(checkbox, "keyup", key(" "))).toBe(true);
      expect(performKeyDefault(radio, "keyup", key(" "))).toBe(true);

      expect(clicked).toHaveBeenCalledOnce();
      expect((checkbox as HTMLInputElement).checked).toBe(true);
      expect((radio as HTMLInputElement).checked).toBe(true);
    });

    it("does nothing on keydown, in text fields or on plain elements", () => {
      expect(performKeyDefault(el("button"), "keydown", key(" "))).toBe(false);
      expect(performKeyDefault(el("input", { type: "text" }), "keyup", key(" "))).toBe(false);
      expect(performKeyDefault(el("div"), "keyup", key(" "))).toBe(false);
    });
  });

  it("does nothing with modifier keys held", () => {
    const button = el("button");
    for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey"] as const) {
      expect(performKeyDefault(button, "keydown", key("Enter", { [modifier]: true }))).toBe(false);
    }
  });

  it("does nothing on disabled controls", () => {
    const button = el("button");
    button.disabled = true;
    const fieldset = el("fieldset", { disabled: "" });
    const inside = document.createElement("button");
    fieldset.append(inside);

    expect(performKeyDefault(button, "keydown", key("Enter"))).toBe(false);
    expect(performKeyDefault(inside, "keyup", key(" "))).toBe(false);
  });
});
