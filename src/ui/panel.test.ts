import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_CONFIG } from "../shared/constants";
import type { PanelController, StateConfig, StateStore } from "../shared/types";
import { createPanel } from "./panel";

function fakeConfig(): StateStore<StateConfig> {
  return {
    state: { ...DEFAULT_CONFIG },
    ready: Promise.resolve({ ...DEFAULT_CONFIG }),
    set: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => true),
  };
}

/** happy-dom has no layout: give an element a fixed rect. */
function stubRect(el: Element, left: number, top: number, width: number, height: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

function mount() {
  const panel = createPanel({ windowId: "window-1", config: fakeConfig() });
  const host = document.getElementById("mirror-sync-panel")!;
  const shadow = host.shadowRoot!;
  const handle = shadow.querySelector<HTMLElement>(".drag-handle")!;
  // Panel 150×100 at (800, 10); the handle sticks out 5px up and left.
  stubRect(host, 800, 10, 150, 100);
  stubRect(handle, 795, 5, 10, 10);
  return { panel, host, shadow, handle };
}

function stubHit(shadow: ShadowRoot, hit: Element | null) {
  Object.defineProperty(shadow, "elementFromPoint", { configurable: true, value: () => hit });
}

describe("createPanel", () => {
  beforeEach(() => {
    window.innerWidth = 1000;
    window.innerHeight = 600;
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  describe("hitTest", () => {
    it("names the part of the panel at a point", () => {
      const { panel, host, shadow, handle } = mount();

      stubHit(shadow, handle);
      expect(panel.hitTest(800, 10)).toBe("handle");

      stubHit(shadow, shadow.querySelector(".toggle-switch-slider"));
      expect(panel.hitTest(900, 50)).toBe("toggle");

      stubHit(shadow, shadow.querySelector(".badge"));
      expect(panel.hitTest(850, 20)).toBe("body");

      stubHit(shadow, host);
      expect(panel.hitTest(810, 90)).toBe("body");
    });

    it("returns null for points off the panel", () => {
      const { panel, shadow } = mount();

      stubHit(shadow, document.body);
      expect(panel.hitTest(10, 10)).toBeNull();

      stubHit(shadow, null);
      expect(panel.hitTest(-1, -1)).toBeNull();
    });
  });

  describe("setPosition", () => {
    it("moves the panel to the given position", () => {
      const { panel, host } = mount();

      panel.setPosition({ left: 300, top: 200 });

      expect(host.style.left).toBe("300px");
      expect(host.style.top).toBe("200px");
      expect(host.style.right).toBe("auto");
    });

    it("keeps the panel and its handle inside this viewport", () => {
      const { panel, host } = mount();

      panel.setPosition({ left: 2000, top: -50 });

      expect(host.style.left).toBe("850px"); // 1000 - 150
      expect(host.style.top).toBe("5px"); // handle sticks out 5px
    });
  });

  describe("onDrag", () => {
    function drag(handle: HTMLElement) {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          composed: true,
          clientX: 800,
          clientY: 10,
        }),
      );
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 500, clientY: 300 }));
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 500, clientY: 300 }));
    }

    it("reports start, move and end of a local drag with the pointer position", () => {
      const { panel, handle } = mount();
      const phases: Array<[string, { x: number; y: number }]> = [];
      panel.onDrag((phase, _position, point) => phases.push([phase, point]));

      drag(handle);

      expect(phases).toEqual([
        ["start", { x: 800, y: 10 }],
        ["move", { x: 500, y: 300 }],
        ["end", { x: 500, y: 300 }],
      ]);
    });

    it("does not report remote moves or after unsubscribing", () => {
      const { panel, handle } = mount();
      const listener = vi.fn();
      const stop = panel.onDrag(listener);

      panel.setPosition({ left: 100, top: 100 });
      stop();
      drag(handle);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  it("starts when <body> already exists, as when the worker injects the script", () => {
    expect(document.body).not.toBeNull();
    expect(() => createPanel({ windowId: "window-2", config: fakeConfig() })).not.toThrow();
    expect(document.getElementById("mirror-sync-panel")).not.toBeNull();
  });

  it("is a PanelController", () => {
    const { panel } = mount();
    const controller: PanelController = panel;
    expect(typeof controller.flash).toBe("function");
  });
});
