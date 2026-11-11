import { describe, expect, it, vi } from "vite-plus/test";
import {
  fingerprint,
  isValueField,
  sameField,
  sameRect,
  setNativeValue,
  type FieldFingerprint,
} from "./field-fingerprint";

function input(type?: string) {
  const el = document.createElement("input");
  if (type) el.setAttribute("type", type);
  return el;
}

describe("isValueField", () => {
  it.each(["", "text", "search", "email", "url", "tel", "number", "date", "range", "color"])(
    "accepts <input type=%s>",
    (type) => {
      expect(isValueField(input(type || undefined))).toBe(true);
    },
  );

  it("accepts textareas and selects", () => {
    expect(isValueField(document.createElement("textarea"))).toBe(true);
    expect(isValueField(document.createElement("select"))).toBe(true);
  });

  it.each(["password", "checkbox", "radio", "file", "button", "submit", "reset", "hidden"])(
    "never accepts <input type=%s>",
    (type) => {
      expect(isValueField(input(type))).toBe(false);
    },
  );

  it("rejects everything else", () => {
    expect(isValueField(document.createElement("div"))).toBe(false);
    expect(isValueField(null)).toBe(false);
  });
});

describe("fingerprint / sameField", () => {
  function tweakpaneField() {
    const el = input("text");
    el.className = "tp-txtv_i tp-v";
    return el;
  }

  it("captures the identifying attributes, with classes sorted", () => {
    const el = tweakpaneField();
    el.id = "seed";
    el.setAttribute("name", "seed");
    el.setAttribute("placeholder", "Seed");
    el.setAttribute("aria-label", "Seed response");

    expect(fingerprint(el)).toEqual<FieldFingerprint>({
      tag: "INPUT",
      type: "text",
      id: "seed",
      name: "seed",
      placeholder: "Seed",
      ariaLabel: "Seed response",
      classes: ["tp-txtv_i", "tp-v"],
    });
  });

  it("matches the same field regardless of class order, with absent attributes equal", () => {
    const a = tweakpaneField();
    const b = input("text");
    b.className = "tp-v tp-txtv_i";

    expect(sameField(fingerprint(a), fingerprint(b))).toBe(true);
  });

  it.each<[string, (el: HTMLInputElement) => void]>([
    ["an extra class", (el) => el.classList.add("extra")],
    ["a different id", (el) => (el.id = "other")],
    ["a name", (el) => el.setAttribute("name", "x")],
    ["a placeholder", (el) => el.setAttribute("placeholder", "x")],
    ["an aria-label", (el) => el.setAttribute("aria-label", "x")],
    ["a different type", (el) => el.setAttribute("type", "number")],
  ])("tells fields apart by %s", (_label, change) => {
    const a = tweakpaneField();
    const b = tweakpaneField();
    change(b);

    expect(sameField(fingerprint(a), fingerprint(b))).toBe(false);
  });

  it("tells an input from a textarea with the same classes", () => {
    const a = tweakpaneField();
    const b = document.createElement("textarea");
    b.className = a.className;

    expect(sameField(fingerprint(a), fingerprint(b))).toBe(false);
  });
});

describe("sameRect", () => {
  const rect = { left: 100, top: 200, width: 150, height: 20 };

  it("allows 1px of difference on each value", () => {
    expect(sameRect(rect, { left: 101, top: 199, width: 151, height: 19 })).toBe(true);
  });

  it("rejects anything more", () => {
    expect(sameRect(rect, { ...rect, left: 102 })).toBe(false);
    expect(sameRect(rect, { ...rect, width: 148 })).toBe(false);
  });
});

describe("setNativeValue", () => {
  it("writes through the prototype setter, bypassing an instance-level tracker like React's", () => {
    const el = input("text");
    const tracked = vi.fn();
    // React installs an own `value` property on controlled inputs to remember what it set.
    Object.defineProperty(el, "value", {
      configurable: true,
      get: () => "stale",
      set: tracked,
    });

    setNativeValue(el, "12345");

    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    expect(tracked).not.toHaveBeenCalled();
    expect(nativeValue.get!.call(el)).toBe("12345");
  });

  it("works for textareas and selects", () => {
    const area = document.createElement("textarea");
    setNativeValue(area, "line 1\nline 2");
    expect(area.value).toBe("line 1\nline 2");

    const select = document.createElement("select");
    for (const value of ["a", "b"]) {
      const option = document.createElement("option");
      option.value = value;
      select.append(option);
    }
    setNativeValue(select, "b");
    expect(select.value).toBe("b");
  });
});
