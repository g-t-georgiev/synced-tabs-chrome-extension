import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { anchorAt, isWithin, matchAnchor, resolveAnchor } from "./element-anchor";

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
    // 1920x1080 window with a centred 1600x900 canvas; the same layout at 1280x720.
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
    rectOf(button!, 900, 300, 200, 20); // in a 1920x1080 window
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

describe("matchAnchor: why a press doesn't match (step 13d)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  function button(className: string) {
    const el = document.createElement("div");
    el.className = className;
    document.body.append(el);
    return el;
  }

  it("says when nothing is at the point", () => {
    const sender = button("PlayButton_icon");
    rectOf(sender, 0, 0, 10, 10);
    const anchor = anchorAt(sender, 5, 5);
    stubHit();

    expect(matchAnchor(anchor, { x: 12.4, y: 7.6 })).toEqual({
      found: false,
      reason: "nothing at (12, 8)",
    });
  });

  it("names the first identity difference and both elements", () => {
    const sender = button("PlayButton_icon");
    rectOf(sender, 0, 0, 10, 10);
    const anchor = anchorAt(sender, 5, 5);
    const glow = button("PlayButton_glow");
    stubHit(glow);

    const match = matchAnchor(anchor, { x: 5, y: 5 });

    expect(match).toEqual({
      found: false,
      reason:
        "identity differs at level 0, classes: [PlayButton_glow] vs [PlayButton_icon] " +
        "(hit div.PlayButton_glow:nth-of-type(1), expected div.PlayButton_icon:nth-of-type(1))",
    });
  });

  it("gives the expected and found boxes when only the box differs", () => {
    const icon = button("PlayButton_icon");
    rectOf(icon, 1180, 620, 97, 97); // in a 1280x720 window
    const anchor = anchorAt(icon, 1228, 668);

    window.innerWidth = 1920;
    window.innerHeight = 1080;
    rectOf(icon, 1748, 870, 120, 120); // the UI didn't grow by 1.5x
    stubHit(icon);

    expect(matchAnchor(anchor, { x: 1842, y: 1002 }, { sender: { w: 1280, h: 720 } })).toEqual({
      found: false,
      reason:
        "box differs: expected 146x146 centred at (1843, 1003) (sender 97x97 x1.50), " +
        "found 120x120 centred at (1808, 930) on div.PlayButton_icon:nth-of-type(1)",
    });
  });

  it("returns the match like resolveAnchor when everything agrees", () => {
    const icon = button("PlayButton_icon");
    rectOf(icon, 100, 100, 50, 50);
    const anchor = anchorAt(icon, 125, 125);
    stubHit(icon);

    expect(matchAnchor(anchor, { x: 125, y: 125 })).toEqual({
      found: true,
      element: icon,
      x: 125,
      y: 125,
    });
  });
});

describe("box check: uniform scaling across aspect ratios (step 13e)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
    window.innerWidth = 1024;
    window.innerHeight = 768;
  });

  function playIcon() {
    const el = document.createElement("div");
    el.className = "PlayButton_icon__8KJx3";
    document.body.append(el);
    return el;
  }

  // The real case from the step 13d log: 1920x1031 → 2560x1271, the UI scaled by ~x1.2.
  it("accepts a button the UI scaled uniformly when the aspect ratios differ", () => {
    const icon = playIcon();
    rectOf(icon, 1758.75, 861.45, 142.5, 141.1); // in the 1920x1031 window
    const anchor = anchorAt(icon, 1830, 932);

    window.innerWidth = 2560;
    window.innerHeight = 1271;
    rectOf(icon, 2363, 1064, 171, 169);
    stubHit(icon);

    const match = matchAnchor(anchor, { x: 2440, y: 1149 }, { sender: { w: 1920, h: 1031 } });
    expect(match).toMatchObject({ found: true, element: icon });
  });

  it("accepts the same case the other way round", () => {
    const icon = playIcon();
    rectOf(icon, 2363, 1064, 171, 169); // in the 2560x1271 window
    const anchor = anchorAt(icon, 2448, 1148);

    window.innerWidth = 1920;
    window.innerHeight = 1031;
    rectOf(icon, 1758.75, 861.45, 142.5, 141.1);
    stubHit(icon);

    const match = matchAnchor(anchor, { x: 1836, y: 931 }, { sender: { w: 2560, h: 1271 } });
    expect(match).toMatchObject({ found: true, element: icon });
  });

  it("still accepts a page that stretches each axis by its own ratio", () => {
    const icon = playIcon();
    rectOf(icon, 1758.75, 861.45, 142.5, 141.1);
    const anchor = anchorAt(icon, 1830, 932);

    window.innerWidth = 2560;
    window.innerHeight = 1271;
    rectOf(icon, 2345, 1062, 190, 174); // x1.333 wide, x1.233 tall
    stubHit(icon);

    expect(
      matchAnchor(anchor, { x: 2440, y: 1149 }, { sender: { w: 1920, h: 1031 } }),
    ).toMatchObject({ found: true });
  });

  it("rejects a uniform scale outside the window ratios, like fixed-pixel UI", () => {
    const icon = playIcon();
    rectOf(icon, 1758.75, 861.45, 142.5, 141.1);
    const anchor = anchorAt(icon, 1830, 932);

    window.innerWidth = 2560;
    window.innerHeight = 1271;
    rectOf(icon, 2369, 1078, 142.5, 141.1); // same pixels, centred where it should be
    stubHit(icon);

    expect(
      matchAnchor(anchor, { x: 2440, y: 1149 }, { sender: { w: 1920, h: 1031 } }),
    ).toMatchObject({ found: false });
  });

  it("rejects a uniformly scaled box whose centre moved", () => {
    const icon = playIcon();
    rectOf(icon, 1758.75, 861.45, 142.5, 141.1);
    const anchor = anchorAt(icon, 1830, 932);

    window.innerWidth = 2560;
    window.innerHeight = 1271;
    rectOf(icon, 2363, 1000, 171, 169); // 64px higher than expected
    stubHit(icon);

    expect(
      matchAnchor(anchor, { x: 2440, y: 1149 }, { sender: { w: 1920, h: 1031 } }),
    ).toMatchObject({ found: false, reason: expect.stringContaining("box differs") });
  });
});

describe("element anchors: siblings that differ between tabs", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  /** <body> > <div.debug> > <div.tp-toggle-btn>, after `before` other body children. */
  function debugToggle(before: Element[]) {
    document.body.replaceChildren(...before);
    const container = document.createElement("div");
    container.className = "debug";
    const toggle = document.createElement("div");
    toggle.className = "tp-toggle-btn";
    container.append(toggle);
    document.body.append(container);
    rectOf(toggle, 1200, 60, 80, 28);
    return toggle;
  }

  function ownUi() {
    const el = document.createElement("div");
    el.setAttribute("data-mirror-sync-ui", "");
    return el;
  }

  it("ignores the extension's own elements, which differ per tab (the real case)", () => {
    // Sender: panel and cursor. Receiver: also a focus ring, created where one was shown.
    const anchor = anchorAt(debugToggle([ownUi(), ownUi()]), 1240, 74);
    const toggle = debugToggle([ownUi(), ownUi(), ownUi()]);
    stubHit(toggle);

    expect(resolveAnchor(anchor, { x: 1240, y: 74 })?.element).toBe(toggle);
  });

  it("ignores page siblings that look different", () => {
    const toast = document.createElement("div");
    toast.className = "toast";
    const anchor = anchorAt(debugToggle([]), 1240, 74);
    const toggle = debugToggle([toast]);
    stubHit(toggle);

    expect(resolveAnchor(anchor, { x: 1240, y: 74 })?.element).toBe(toggle);
  });

  it("still tells look-alike siblings apart", () => {
    const twin = document.createElement("div");
    twin.className = "debug";
    const anchor = anchorAt(debugToggle([]), 1240, 74);
    const toggle = debugToggle([twin]); // now the second div.debug
    stubHit(toggle);

    expect(resolveAnchor(anchor, { x: 1240, y: 74 })).toBeNull();
  });
});
