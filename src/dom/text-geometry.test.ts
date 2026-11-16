import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { isSelectableField, selectionRects } from "./text-geometry";

type Box = { left: number; top: number; width: number; height: number };

/** happy-dom has no layout: the mirror sits at (1000, 500), the measured span as given. */
function stubLayout(spanRects: Box[]) {
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 1000,
    top: 500,
  } as DOMRect);
  vi.spyOn(HTMLSpanElement.prototype, "getClientRects").mockReturnValue(
    spanRects as unknown as DOMRectList,
  );
}

function input(type = "text", value = "hello world") {
  const el = document.createElement("input");
  el.type = type;
  el.value = value;
  document.body.append(el);
  return el;
}

describe("isSelectableField", () => {
  it.each(["text", "search", "url", "tel"])("accepts <input type=%s>", (type) => {
    expect(isSelectableField(input(type))).toBe(true);
  });

  it("accepts textareas", () => {
    expect(isSelectableField(document.createElement("textarea"))).toBe(true);
  });

  it.each(["number", "email", "password", "checkbox"])("rejects <input type=%s>", (type) => {
    expect(isSelectableField(input(type))).toBe(false);
  });
});

describe("selectionRects", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("returns the selected text's boxes relative to the field, after its scrolling", () => {
    const field = input();
    Object.defineProperty(field, "scrollLeft", { value: 30 });
    stubLayout([{ left: 1050, top: 504, width: 40, height: 16 }]);

    expect(selectionRects(field, 0, 5)).toEqual([{ left: 20, top: 4, width: 40, height: 16 }]);
  });

  it("returns one box per line for a selection spanning lines", () => {
    const area = document.createElement("textarea");
    area.value = "line one\nline two";
    document.body.append(area);
    stubLayout([
      { left: 1030, top: 504, width: 40, height: 16 },
      { left: 1004, top: 520, width: 30, height: 16 },
    ]);

    expect(selectionRects(area, 5, 13)).toHaveLength(2);
  });

  it("returns a 2px caret for an empty range", () => {
    const field = input();
    stubLayout([{ left: 1060, top: 504, width: 0, height: 16 }]);

    expect(selectionRects(field, 3, 3)).toEqual([{ left: 60, top: 4, width: 2, height: 16 }]);
  });

  it("lays the text out like the field and cleans up after measuring", () => {
    const field = input("text", "abcdef");
    field.style.fontSize = "13px";
    field.style.paddingLeft = "6px";
    const measured = vi
      .spyOn(HTMLDivElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 0, top: 0 } as DOMRect);
    vi.spyOn(HTMLSpanElement.prototype, "getClientRects").mockReturnValue(
      [] as unknown as DOMRectList,
    );

    selectionRects(field, 1, 4);
    // The element the mirror's box was read from.
    const mirror = measured.mock.contexts[0] as HTMLElement;

    expect(mirror!.style.fontSize).toBe("13px");
    expect(mirror!.style.paddingLeft).toBe("6px");
    expect(mirror!.style.whiteSpace).toBe("pre");
    expect(mirror!.textContent).toBe("abcdef");
    expect(mirror!.querySelector("span")!.textContent).toBe("bcd");
    expect(mirror!.isConnected).toBe(false);
  });

  it("clamps the range to the value", () => {
    const field = input("text", "abc");
    let selected = "";
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
    } as DOMRect);
    vi.spyOn(HTMLSpanElement.prototype, "getClientRects").mockImplementation(function (
      this: HTMLSpanElement,
    ) {
      selected = this.textContent ?? "";
      return [] as unknown as DOMRectList;
    });

    selectionRects(field, 1, 99);

    expect(selected).toBe("bc");
  });
});
