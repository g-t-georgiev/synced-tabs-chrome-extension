import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { MessageController } from "../shared/types";
import { anchorAt, type ElementAnchor } from "../dom";
import { createPointerSync } from "./pointer-sync";

function setup() {
  const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
  const logger = { initialized: vi.fn(), remote: vi.fn(), execute: vi.fn(), dropped: vi.fn() };
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

describe("createPointerSync: identity check at the same window size (step 13b)", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  function button(className: string) {
    const el = document.createElement("button");
    el.className = className;
    document.body.append(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 600,
      top: 340,
      width: 80,
      height: 40,
    } as DOMRect);
    return el;
  }

  function pressAt(extra: Record<string, unknown>) {
    return {
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      viewport: { w: 1280, h: 720 },
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType: "pointerdown",
      xRatio: 0.5,
      yRatio: 0.5,
      button: 0,
      buttons: 1,
      ...extra,
    };
  }

  it("drops a click when another element sits at that spot", () => {
    const sender = button("spin");
    const anchor = anchorAt(sender, 640, 360);
    sender.remove();
    const other = button("bet");
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [other],
    });
    const seen = vi.fn();
    other.addEventListener("pointerdown", seen);

    const { feature } = setup();
    expect(feature.apply(pressAt({ anchor }))).toEqual({
      status: "dropped",
      reason: "element-mismatch",
    });
    expect(seen).not.toHaveBeenCalled();
  });

  it("clicks the same element", () => {
    const target = button("spin");
    const anchor = anchorAt(target, 640, 360);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target],
    });
    const seen = vi.fn();
    target.addEventListener("pointerdown", seen);

    const { feature } = setup();
    expect(feature.apply(pressAt({ anchor }))).toBeUndefined();
    expect(seen).toHaveBeenCalledOnce();
  });

  it("keeps the old behaviour for messages from older builds without an anchor", () => {
    const target = button("bet");
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target],
    });
    const seen = vi.fn();
    target.addEventListener("pointerdown", seen);

    const { feature } = setup();
    expect(feature.apply(pressAt({}))).toBeUndefined();
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe("createPointerSync: one decision per press (step 13c)", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  /** A spin button whose look changes while pressed, like the game's. */
  function spinButton(className = "PlayButton_icon") {
    const el = document.createElement("div");
    el.className = className;
    document.body.append(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 1180,
      top: 620,
      width: 80,
      height: 80,
    } as DOMRect);
    return el;
  }

  function hitOnly(el: Element) {
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [el] });
  }

  function message(subType: string, anchor: ElementAnchor, extra: Record<string, unknown> = {}) {
    return {
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      viewport: { w: 1280, h: 720 },
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType,
      xRatio: 1220 / 1280,
      yRatio: 660 / 720,
      button: 0,
      buttons: subType === "pointerdown" ? 1 : 0,
      anchor,
      ...extra,
    };
  }

  function record(el: Element) {
    const seen: string[] = [];
    for (const type of [
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "pointercancel",
      "click",
    ]) {
      el.addEventListener(type, () => seen.push(type));
    }
    return seen;
  }

  /** Anchors for the sender's press: normal on down, pressed look on up and click. */
  function senderPress() {
    const button = spinButton();
    const down = anchorAt(button, 1220, 660);
    button.classList.add("PlayButton_pressed");
    const up = anchorAt(button, 1220, 660);
    button.remove();
    return { down, up };
  }

  it("releases and clicks the pressed element even if its look changed meanwhile", () => {
    const { down, up } = senderPress();
    const receiver = spinButton();
    hitOnly(receiver);
    const seen = record(receiver);
    const { feature } = setup();

    expect(feature.apply(message("pointerdown", down))).toBeUndefined();
    expect(feature.apply(message("pointerup", up))).toBeUndefined();
    expect(feature.apply(message("click", up, { samePress: true }))).toBeUndefined();

    expect(seen).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  });

  it("drops the whole press when its pointerdown is dropped", () => {
    const { down } = senderPress();
    const receiver = spinButton("Other_button");
    hitOnly(receiver);
    const seen = record(receiver);
    const { feature } = setup();

    const dropped = feature.apply(message("pointerdown", down));
    // Even an up and click whose own anchors would match here are not applied.
    const own = anchorAt(receiver, 1220, 660);
    expect(feature.apply(message("pointerup", own))).toEqual(dropped);
    expect(feature.apply(message("click", own, { samePress: true }))).toEqual(dropped);

    expect(dropped).toMatchObject({ reason: "element-mismatch" });
    expect(seen).toEqual([]);
  });

  it("checks a click on its own when the sender released elsewhere", () => {
    const panel = document.createElement("div");
    panel.className = "controls";
    document.body.append(panel);
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      left: 1100,
      top: 600,
      width: 180,
      height: 120,
    } as DOMRect);
    const { down } = senderPress();
    const receiver = spinButton();
    hitOnly(receiver);
    const panelClicks = vi.fn();
    panel.addEventListener("click", panelClicks);
    const seen = record(receiver);
    const { feature } = setup();

    feature.apply(message("pointerdown", down));
    feature.apply(message("pointerup", down));
    // The browser clicked the container holding both elements, not the pressed one.
    const result = feature.apply(
      message("click", anchorAt(panel, 1220, 660), { samePress: false }),
    );

    expect(seen).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup"]);
    expect(result).toMatchObject({ reason: "element-mismatch" }); // the container isn't at the spot
    expect(panelClicks).not.toHaveBeenCalled();
  });

  it("mirrors pointercancel to the pressed element", () => {
    const { down } = senderPress();
    const receiver = spinButton();
    hitOnly(receiver);
    const seen = record(receiver);
    const { feature } = setup();

    feature.apply(message("pointerdown", down));
    feature.apply(message("pointercancel", down));

    expect(seen).toEqual(["pointerdown", "mousedown", "pointercancel"]);
  });

  it("releases a held press when mouse sync is turned off", () => {
    const { down } = senderPress();
    const receiver = spinButton();
    hitOnly(receiver);
    const seen = record(receiver);
    const { feature } = setup();
    const stop = feature.capture();

    feature.apply(message("pointerdown", down));
    stop();

    expect(seen).toEqual(["pointerdown", "mousedown", "pointercancel"]);
  });

  it("sends pointercancel, and whether a click landed on the pressed element", () => {
    const { transport, feature } = setup();
    const stop = feature.capture();
    const button = spinButton();
    const other = spinButton("Other_button");
    const fire = (el: Element, type: string) =>
      el.dispatchEvent(trusted(new PointerEvent(type, { bubbles: true, composed: true })));

    fire(button, "pointerdown");
    fire(button, "pointerup");
    fire(button, "click");
    fire(button, "pointerdown");
    fire(other, "click");
    fire(button, "pointercancel");
    stop();

    const sent = transport.broadcast.mock.calls.map(([payload]) => [
      payload.subType,
      payload.samePress,
    ]);
    expect(sent).toEqual([
      ["pointerdown", undefined],
      ["pointerup", undefined],
      ["click", true],
      ["pointerdown", undefined],
      ["click", false],
      ["pointercancel", undefined],
    ]);
  });
});

describe("createPointerSync: drop reasons in the log (step 13d)", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  function element(className: string) {
    const el = document.createElement("div");
    el.className = className;
    document.body.append(el);
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 1180,
      top: 620,
      width: 80,
      height: 80,
    } as DOMRect);
    return el;
  }

  function message(
    subType: string,
    anchor: ElementAnchor | undefined,
    viewport = { w: 1280, h: 720 },
  ) {
    return {
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      viewport,
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType,
      xRatio: 1220 / 1280,
      yRatio: 660 / 720,
      ...(anchor ? { anchor } : {}),
    };
  }

  function setupWithLog() {
    const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
    const logger = { initialized: vi.fn(), remote: vi.fn(), execute: vi.fn(), dropped: vi.fn() };
    return { feature: createPointerSync({ transport, logger }), logger };
  }

  it("logs why a press was dropped, then that its release and click followed it", () => {
    const sender = element("PlayButton_icon");
    const anchor = anchorAt(sender, 1220, 660);
    sender.remove();
    const other = element("PlayButton_glow");
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [other],
    });
    const { feature, logger } = setupWithLog();

    feature.apply(message("pointerdown", anchor));
    feature.apply(message("pointerup", anchor));
    feature.apply(message("click", anchor));

    expect(logger.dropped.mock.calls).toEqual([
      ["pointerdown", expect.stringContaining("identity differs at level 0, classes")],
      ["pointerup", "its pointerdown was dropped"],
      ["click", "its pointerdown was dropped"],
    ]);
  });

  it("adds both window sizes when they differ", () => {
    const sender = element("PlayButton_icon");
    const anchor = anchorAt(sender, 1220, 660);
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
    const { feature, logger } = setupWithLog();

    feature.apply(message("pointerdown", anchor, { w: 1920, h: 1080 }));

    expect(logger.dropped).toHaveBeenCalledWith(
      "pointerdown",
      expect.stringMatching(/ \[sender 1920×1080, here 1280×720\]$/),
    );
  });

  it("explains drops of anchorless messages from older builds", () => {
    const { feature, logger } = setupWithLog();

    feature.apply(message("pointerdown", undefined, { w: 1920, h: 1080 }));

    expect(logger.dropped).toHaveBeenCalledWith(
      "pointerdown",
      expect.stringContaining("the sender sent no anchor (older build)"),
    );
  });
});
