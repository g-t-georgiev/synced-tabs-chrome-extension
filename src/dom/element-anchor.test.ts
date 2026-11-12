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
    rectOf(receiver.canvas, 0, 0, 1280, 720); // same layout, smaller window
    stubHit(receiver.canvas);

    expect(resolveAnchor(anchor, { x: 640, y: 180 })).toEqual({
      element: receiver.canvas,
      x: 640,
      y: 180,
    });
  });

  it("follows the element even if it's letterboxed differently", () => {
    const sender = game();
    rectOf(sender.canvas, 0, 0, 1600, 900);
    const anchor = anchorAt(sender.canvas, 800, 450); // centre
    sender.root.remove();

    const receiver = game();
    rectOf(receiver.canvas, 100, 0, 1280, 720);
    stubHit(receiver.canvas);

    expect(resolveAnchor(anchor, { x: 700, y: 360 })).toMatchObject({ x: 740, y: 360 });
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
    rectOf(button, 10, 10, 80, 32);
    stubHit(label);

    expect(resolveAnchor(anchor, { x: 50, y: 26 })?.element).toBe(button);
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
