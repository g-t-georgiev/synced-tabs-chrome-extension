import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { MessageController } from "../shared/types";
import { anchorAt, type ElementAnchor } from "../dom";
import { createPointerSync } from "./pointer-sync";

function setup() {
  const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
  const logger = { initialized: vi.fn(), remote: vi.fn(), execute: vi.fn() };
  const feature = createPointerSync({ transport, logger });
  return { transport, feature };
}

/** happy-dom events are untrusted; the capture path only accepts trusted ones. */
function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

describe("createPointerSync", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
  });

  it("broadcasts the pressed button state with the position", () => {
    const { transport, feature } = setup();
    const stop = feature.capture();

    window.dispatchEvent(
      trusted(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, button: 2, buttons: 2 })),
    );
    stop();

    expect(transport.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MESSAGE_TYPES.POINTER_EVENT,
        subType: "pointerdown",
        button: 2,
        buttons: 2,
      }),
      { report: "Clicks" },
    );
  });

  it("replays a message as a pointer event with its compatibility mouse event", () => {
    const { feature } = setup();
    const target = document.createElement("button");
    document.body.append(target);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target],
    });
    const seen: string[] = [];
    target.addEventListener("pointerdown", (e) =>
      seen.push(`${e.type}:${(e as MouseEvent).buttons}`),
    );
    target.addEventListener("mousedown", (e) =>
      seen.push(`${e.type}:${(e as MouseEvent).buttons}`),
    );

    feature.apply({
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType: "pointerdown",
      xRatio: 0.5,
      yRatio: 0.5,
      button: 0,
      buttons: 1,
    });

    expect(seen).toEqual(["pointerdown:1", "mousedown:1"]);
  });

  it("treats messages without button state as a primary-button press", () => {
    const { feature } = setup();
    const target = document.createElement("button");
    document.body.append(target);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target],
    });
    const seen: number[] = [];
    target.addEventListener("pointerdown", (e) => seen.push((e as MouseEvent).buttons));

    feature.apply({
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType: "pointerdown",
      xRatio: 0.5,
      yRatio: 0.5,
    });

    expect(seen).toEqual([1]);
  });
});

describe("createPointerSync: window size mismatch", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
  });

  it("drops presses from a sender with a different window size", () => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
    const { feature } = setup();
    const target = document.createElement("button");
    document.body.append(target);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target],
    });
    const seen = vi.fn();
    target.addEventListener("pointerdown", seen);

    const result = feature.apply({
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      viewport: { w: 1280, h: 577 },
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType: "pointerdown",
      xRatio: 0.5,
      yRatio: 0.5,
    });

    expect(result).toEqual({
      status: "dropped",
      reason: "viewport-mismatch",
      viewport: { w: 1280, h: 720 },
    });
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("createPointerSync: different window size, same element", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  function canvasAt(left: number, top: number, width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.className = "game";
    document.body.append(canvas);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left,
      top,
      width,
      height,
    } as DOMRect);
    return canvas;
  }

  function press(anchor: ElementAnchor) {
    return {
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      viewport: { w: 1920, h: 1080 },
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType: "pointerdown",
      xRatio: 0.25,
      yRatio: 0.5,
      button: 0,
      buttons: 1,
      anchor,
    };
  }

  it("sends an anchor for the element under the pointer", () => {
    const { transport, feature } = setup();
    const canvas = canvasAt(0, 0, 1920, 1080);
    const stop = feature.capture();

    canvas.dispatchEvent(
      trusted(
        new PointerEvent("pointerdown", {
          bubbles: true,
          composed: true,
          clientX: 480,
          clientY: 540,
        }),
      ),
    );
    stop();

    expect(transport.broadcast.mock.calls[0]![0].anchor).toMatchObject({ rx: 0.25, ry: 0.5 });
  });

  it("clicks the same spot inside the same element when the page scales with the window", () => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
    const sender = canvasAt(0, 0, 1920, 1080);
    const anchor = anchorAt(sender, 480, 540);
    sender.remove();
    const receiver = canvasAt(0, 0, 1280, 720);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [receiver],
    });
    const seen: Array<[number, number]> = [];
    receiver.addEventListener("pointerdown", (e) => seen.push([e.clientX, e.clientY]));

    const { feature } = setup();
    expect(feature.apply(press(anchor))).toBeUndefined();

    expect(seen).toEqual([[320, 360]]);
  });

  it("still drops the click when the element there is a different one", () => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
    const sender = canvasAt(0, 0, 1920, 1080);
    const anchor = anchorAt(sender, 480, 540);
    sender.remove();
    const other = document.createElement("div");
    document.body.append(other);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [other],
    });
    const seen = vi.fn();
    other.addEventListener("pointerdown", seen);

    const { feature } = setup();
    expect(feature.apply(press(anchor))).toMatchObject({ reason: "viewport-mismatch" });
    expect(seen).not.toHaveBeenCalled();
  });
});
