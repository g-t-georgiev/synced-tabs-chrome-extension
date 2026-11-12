import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { anchorAt, isWithin, resolveAnchor } from "./element-anchor";

function rectOf(el: Element, left: number, top: number, width: number, height: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ left, top, width, height } as DOMRect);
}

function stubHit(...stack: Element[]) {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => stack),
  });
}

/** <div.game> > <div.stage> > <canvas> — a canvas game that scales with the window. */
function game() {
  const root = document.createElement("div");
  root.className = "game";
  const stage = document.createElement("div");
  stage.className = "stage";
  const canvas = document.createElement("canvas");
  stage.append(canvas);
  root.append(stage);
  document.body.append(root);
  return { root, stage, canvas };
}

describe("element anchors", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  it("describes a point by the element under it and its position inside it", () => {
    const { canvas } = game();
    rectOf(canvas, 100, 50, 800, 400);

    const anchor = anchorAt(canvas, 300, 150);

    expect(anchor.rx).toBe(0.25);
    expect(anchor.ry).toBe(0.25);
    expect(anchor.chain.map((identity) => [identity.tag, identity.classes])).toEqual([
      ["CANVAS", []],
      ["DIV", ["stage"]],
      ["DIV", ["game"]],
    ]);
  });

  it("finds the same element and maps the point into its box at this size", () => {
    const sender = game();
    rectOf(sender.canvas, 0, 0, 1920, 1080);
    const anchor = anchorAt(sender.canvas, 960, 270);
    sender.root.remove();

    const receiver = game();
    window.innerWidth = 1280; // same layout, smaller window
    window.innerHeight = 720;
    rectOf(receiver.canvas, 0, 0, 1280, 720);
    stubHit(receiver.canvas);

    expect(resolveAnchor(anchor, { x: 640, y: 180 }, { sender: { w: 1920, h: 1080 } })).toEqual({
      element: receiver.canvas,
      x: 640,
      y: 180,
    });
  });

  it("uses the spot inside the element, so a letterboxed canvas is hit exactly", () => {
    // 1920×1080 window with a centred 1600×900 canvas; the same layout at 1280×720.
    const sender = game();
    rectOf(sender.canvas, 160, 90, 1600, 900);
    const anchor = anchorAt(sender.canvas, 560, 315); // a quarter in from the canvas corner
    sender.root.remove();

    const receiver = game();
    window.innerWidth = 1280;
    window.innerHeight = 720;
    rectOf(receiver.canvas, 106.7, 60, 1066.7, 600);
    stubHit(receiver.canvas);

    const resolved = resolveAnchor(anchor, { x: 373, y: 210 }, { sender: { w: 1920, h: 1080 } });
    expect(resolved!.x).toBeCloseTo(373.4, 1);
    expect(resolved!.y).toBeCloseTo(210, 1);
  });

  it("looks a few levels up from the element hit", () => {
    const sender = document.createElement("button");
    sender.className = "spin";
    document.body.append(sender);
    rectOf(sender, 0, 0, 100, 40);
    const anchor = anchorAt(sender, 50, 20);
    sender.remove();

    const button = document.createElement("button");
    button.className = "spin";
    const label = document.createElement("span");
    button.append(label);
    document.body.append(button);
    rectOf(button, 0, 0, 100, 40);
    stubHit(label);

    expect(resolveAnchor(anchor, { x: 50, y: 20 })?.element).toBe(button);
  });

  it("returns null when a different element is there", () => {
    const { canvas } = game();
    rectOf(canvas, 0, 0, 100, 100);
    const anchor = anchorAt(canvas, 50, 50);

    const other = document.createElement("canvas"); // a canvas, but under different parents
    document.body.append(other);
    stubHit(other);

    expect(resolveAnchor(anchor, { x: 50, y: 50 })).toBeNull();
  });

  it("returns null when an element with other classes is there", () => {
    const sender = document.createElement("button");
    sender.className = "spin";
    document.body.append(sender);
    rectOf(sender, 0, 0, 100, 40);
    const anchor = anchorAt(sender, 50, 20);

    const other = document.createElement("button");
    other.className = "bet";
    document.body.append(other);
    stubHit(other);

    expect(resolveAnchor(anchor, { x: 50, y: 20 })).toBeNull();
  });

  it("isWithin crosses shadow roots", () => {
    const host = document.createElement("div");
    const inner = document.createElement("button");
    host.attachShadow({ mode: "open" }).append(inner);
    document.body.append(host);

    expect(isWithin(inner, host)).toBe(true);
    expect(isWithin(host, inner)).toBe(false);
  });
});

describe("element anchors: siblings and box (step 13b)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  /** A Tweakpane-like folder: rows built from identical markup. */
  function tweakpaneRows(count: number) {
    const folder = document.createElement("div");
    folder.className = "tp-fldv_c";
    const buttons = Array.from({ length: count }, () => {
      const row = document.createElement("div");
      row.className = "tp-lblv";
      const value = document.createElement("div");
      value.className = "tp-lblv_v";
      const button = document.createElement("button");
      button.className = "tp-btnv_b";
      value.append(button);
      row.append(value);
      folder.append(row);
      return button;
    });
    document.body.append(folder);
    return buttons;
  }

  it("tells identical rows apart by their position among siblings", () => {
    const [first, second] = tweakpaneRows(3);
    // Same box for both, so only the identity decides.
    rectOf(first!, 10, 10, 100, 20);
    rectOf(second!, 10, 10, 100, 20);
    const anchor = anchorAt(first!, 60, 20);

    stubHit(second!);
    expect(resolveAnchor(anchor, { x: 60, y: 20 })).toBeNull();

    stubHit(first!);
    expect(resolveAnchor(anchor, { x: 60, y: 20 })?.element).toBe(first);
  });

  it("rejects the same element in another place", () => {
    const button = document.createElement("button");
    button.className = "spin";
    document.body.append(button);
    rectOf(button, 100, 100, 80, 30);
    const anchor = anchorAt(button, 140, 115);

    rectOf(button, 100, 140, 80, 30); // a layout change moved it down by more than 10%
    stubHit(button);

    expect(resolveAnchor(anchor, { x: 140, y: 115 })).toBeNull();
  });

  it("tolerates hover and press effects like scale(1.05)", () => {
    const button = document.createElement("button");
    button.className = "spin";
    document.body.append(button);
    rectOf(button, 98, 99, 84, 32); // hovered in the sending tab
    const anchor = anchorAt(button, 140, 115);

    rectOf(button, 100, 100, 80, 30); // not hovered here
    stubHit(button);

    expect(resolveAnchor(anchor, { x: 140, y: 115 })?.element).toBe(button);
  });

  it("rejects fixed-pixel UI that didn't scale with the window", () => {
    const [button] = tweakpaneRows(1);
    rectOf(button!, 900, 300, 200, 20); // in a 1920×1080 window
    const anchor = anchorAt(button!, 1000, 310);

    window.innerWidth = 1280; // a 2/3 window: a scaling page would put it at 600, 200
    window.innerHeight = 720;
    rectOf(button!, 1080 - 200, 300, 200, 20); // Tweakpane: fixed size, pinned right
    stubHit(button!);

    expect(resolveAnchor(anchor, { x: 667, y: 207 }, { sender: { w: 1920, h: 1080 } })).toBeNull();
  });

  it("still resolves anchors from older builds without a box or sibling index", () => {
    const button = document.createElement("button");
    button.className = "spin";
    document.body.append(button);
    rectOf(button, 0, 0, 100, 40);
    const { chain, rx, ry } = anchorAt(button, 50, 20);
    const legacy = {
      chain: chain.map(({ index: _index, ...identity }) => identity) as typeof chain,
      rx,
      ry,
    };
    stubHit(button);

    expect(resolveAnchor(legacy, { x: 50, y: 20 })?.element).toBe(button);
  });
});
