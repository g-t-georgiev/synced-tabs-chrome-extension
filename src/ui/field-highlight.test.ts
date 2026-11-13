import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { OWN_UI_ATTR } from "../dom";
import { createFieldHighlight } from "./field-highlight";

let frames: FrameRequestCallback[];

/** Renders one animation frame. */
function nextFrame() {
  frames.splice(0).forEach((callback) => callback(0));
}

function rectOf(el: Element, left: number, top: number, width: number, height: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left, top, width, height } as DOMRect);
}

function ring() {
  return document.querySelector<HTMLElement>(`[${OWN_UI_ATTR}]`)!;
}

describe("createFieldHighlight", () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => frames.splice(0));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("outlines the field with a 2px gap, in a host marked as own UI that ignores the mouse", () => {
    const field = document.createElement("input");
    document.body.append(field);
    rectOf(field, 100, 200, 150, 20);

    createFieldHighlight().show(field);

    expect(ring().style.display).toBe("block");
    expect(ring().style.transform).toBe("translate(98px, 198px)");
    expect(ring().style.width).toBe("154px");
    expect(ring().style.height).toBe("24px");
    expect(ring().style.pointerEvents).toBe("none");
  });

  it("follows the field when it moves", () => {
    const field = document.createElement("input");
    document.body.append(field);
    rectOf(field, 100, 200, 150, 20);
    createFieldHighlight().show(field);

    rectOf(field, 100, 50, 150, 20); // the page scrolled
    nextFrame();

    expect(ring().style.transform).toBe("translate(98px, 48px)");
  });

  it("hides while the field has no box, and comes back with it", () => {
    const field = document.createElement("input");
    document.body.append(field);
    rectOf(field, 0, 0, 0, 0); // e.g. inside a collapsed folder
    createFieldHighlight().show(field);
    expect(ring().style.display).toBe("none");

    rectOf(field, 10, 10, 100, 20);
    nextFrame();
    expect(ring().style.display).toBe("block");
  });

  it("goes away when the field leaves the page", () => {
    const field = document.createElement("input");
    document.body.append(field);
    rectOf(field, 10, 10, 100, 20);
    const highlight = createFieldHighlight();
    highlight.show(field);

    field.remove();
    nextFrame();

    expect(ring().style.display).toBe("none");
    expect(highlight.field).toBeNull();
    expect(frames).toHaveLength(0); // stopped following
  });

  it("hide() removes the ring and stops following; show() moves it to another field", () => {
    const first = document.createElement("input");
    const second = document.createElement("textarea");
    document.body.append(first, second);
    rectOf(first, 10, 10, 100, 20);
    rectOf(second, 10, 60, 200, 80);
    const highlight = createFieldHighlight();

    highlight.show(first);
    highlight.show(second);
    expect(highlight.field).toBe(second);
    expect(ring().style.transform).toBe("translate(8px, 58px)");
    expect(document.querySelectorAll(`[${OWN_UI_ATTR}]`)).toHaveLength(1);

    highlight.hide();
    expect(ring().style.display).toBe("none");
    expect(frames).toHaveLength(0);
  });
});

describe("createFieldHighlight: selection and caret", () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => frames.splice(0));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function textField(value = "seed-123") {
    const field = document.createElement("input");
    field.type = "text";
    field.value = value;
    document.body.append(field);
    rectOf(field, 100, 200, 150, 20);
    return field;
  }

  function boxes() {
    return [...ring().firstElementChild!.children].map((box) => (box as HTMLElement).style);
  }

  it("draws the measured selection inside the ring", () => {
    const measure = vi.fn(() => [{ left: 4, top: 2, width: 40, height: 16 }]);
    const highlight = createFieldHighlight({ measure });
    const field = textField();

    highlight.show(field);
    highlight.select(0, 4);

    expect(measure).toHaveBeenCalledWith(field, 0, 4);
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0]).toMatchObject({ left: "4px", top: "2px", width: "40px", height: "16px" });
    expect(boxes()[0]!.background).toContain("rgba(0, 255, 255, 0.3)");
  });

  it("draws an empty range as a solid caret", () => {
    const highlight = createFieldHighlight({
      measure: () => [{ left: 30, top: 2, width: 2, height: 16 }],
    });
    highlight.show(textField());

    highlight.select(3, 3);

    expect(boxes()[0]!.background).not.toContain("0.3");
  });

  it("measures again when the text changes, not on idle frames", () => {
    const measure = vi.fn(() => [{ left: 0, top: 0, width: 10, height: 16 }]);
    const highlight = createFieldHighlight({ measure });
    const field = textField();
    highlight.show(field);
    highlight.select(0, 2);

    nextFrame();
    nextFrame();
    expect(measure).toHaveBeenCalledTimes(1);

    field.value = "other";
    nextFrame();
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("clears the selection on hide and when another field is shown", () => {
    const highlight = createFieldHighlight({
      measure: () => [{ left: 0, top: 0, width: 10, height: 16 }],
    });
    const first = textField();
    const second = textField("x");
    highlight.show(first);
    highlight.select(0, 2);

    highlight.show(second);
    expect(boxes()).toHaveLength(0);

    highlight.select(0, 1);
    highlight.hide();
    expect(boxes()).toHaveLength(0);
  });

  it("ignores a selection when no field is outlined", () => {
    const measure = vi.fn(() => []);
    createFieldHighlight({ measure }).select(0, 1);
    expect(measure).not.toHaveBeenCalled();
  });
});
