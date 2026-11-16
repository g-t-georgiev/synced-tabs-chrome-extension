import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_CONFIG } from "../shared/constants";
import type { PanelController, StateConfig, StateStore } from "../shared/types";
import { createPanel } from "./panel";

function fakeConfig(stored: Partial<StateConfig> = {}): StateStore<StateConfig> {
  return {
    state: { ...DEFAULT_CONFIG, ...stored },
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

function mount(config = fakeConfig()) {
  const panel = createPanel({ windowId: "window-1", config });
  const host = document.getElementById("mirror-sync-panel")!;
  const shadow = host.shadowRoot!;
  const handle = shadow.querySelector<HTMLElement>(".drag-handle")!;
  // Panel 150x100 at (800, 10); the handle sticks out 5px up and left.
  stubRect(host, 800, 10, 150, 100);
  stubRect(handle, 795, 5, 10, 10);
  return { panel, host, shadow, handle, config };
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

  it("has a Same Window Only switch that saves its setting", () => {
    const config = fakeConfig();
    const save = vi.fn(async () => {});
    config.set = save;
    createPanel({ windowId: "window-3", config });
    const toggle = document
      .getElementById("mirror-sync-panel")!
      .shadowRoot!.querySelector<HTMLInputElement>('[id^="sync-window-toggle"]')!;

    expect(toggle.checked).toBe(false); // off by default
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));

    expect(save).toHaveBeenCalledWith("sameWindowOnly", true);
  });

  it("is a PanelController", () => {
    const { panel } = mount();
    const controller: PanelController = panel;
    expect(typeof controller.flash).toBe("function");
  });
});

describe("createPanel: remembered position (steps 16, 16b)", () => {
  beforeEach(() => {
    window.innerWidth = 1000;
    window.innerHeight = 600;
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("starts where it was saved, relative to the saved edges", async () => {
    const { host } = mount(
      fakeConfig({
        panelPosition: { x: { edge: "left", offset: 20 }, y: { edge: "bottom", offset: 130 } },
      }),
    );

    await vi.waitFor(() => expect(host.style.left).toBe("20px"));
    expect(host.style.top).toBe("470px"); // 600 - 130
  });

  it("stays top-right by default when nothing is saved", async () => {
    const { host } = mount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.style.left).toBe("");
  });

  it("ignores a malformed saved position", async () => {
    const { host } = mount(
      fakeConfig({ panelPosition: { left: 5 } as unknown as StateConfig["panelPosition"] }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.style.left).toBe("");
  });

  it("saves the position in the store, relative to the nearest edges, when a drag ends", () => {
    const config = fakeConfig();
    const save = vi.fn(async () => {});
    config.set = save;
    const { handle } = mount(config);

    handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, composed: true, clientX: 800, clientY: 10 }),
    );
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 800, clientY: 10 }));

    // The panel box is 150x100 at (800, 10) in a 1000x600 window: nearest the right edge,
    // its left side 200px from it.
    expect(save).toHaveBeenCalledWith("panelPosition", {
      x: { edge: "right", offset: 200 },
      y: { edge: "top", offset: 10 },
    });
  });

  it("keeps a saved position at its edge when the window is resized", async () => {
    const { host } = mount(
      fakeConfig({
        panelPosition: { x: { edge: "right", offset: 200 }, y: { edge: "top", offset: 10 } },
      }),
    );
    await vi.waitFor(() => expect(host.style.left).toBe("800px"));

    window.innerWidth = 1200;
    window.dispatchEvent(new Event("resize"));

    expect(host.style.left).toBe("1000px");
  });

  it("doesn't follow a position saved later in another tab", async () => {
    const config = fakeConfig({
      panelPosition: { x: { edge: "left", offset: 20 }, y: { edge: "top", offset: 30 } },
    });
    const { host } = mount(config);
    await vi.waitFor(() => expect(host.style.left).toBe("20px"));

    config.state.panelPosition = {
      x: { edge: "left", offset: 400 },
      y: { edge: "top", offset: 30 },
    };
    window.dispatchEvent(new Event("resize")); // even when something makes it re-place itself

    expect(host.style.left).toBe("20px");
  });
});

describe("createPanel: Panel Drag switch (step 16b)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("is on by default and saves its setting", () => {
    const config = fakeConfig();
    const save = vi.fn(async () => {});
    config.set = save;
    createPanel({ windowId: "window-4", config });
    const toggle = document
      .getElementById("mirror-sync-panel")!
      .shadowRoot!.querySelector<HTMLInputElement>('[id^="sync-panel-toggle"]')!;

    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));

    expect(save).toHaveBeenCalledWith("syncPanel", false);
  });
});
