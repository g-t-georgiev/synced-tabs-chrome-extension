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
