import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  OWN_UI_ATTR,
  closestHTMLElement,
  elementAt,
  findScrollableAncestor,
  isFromOwnUi,
  isOwnUi,
} from "./element-resolver";

/** happy-dom has no layout, so hit-testing is stubbed with a fixed stack (topmost first). */
function stubHitStack(...stack: Element[]) {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => stack),
  });
}

function stubShadowHit(root: ShadowRoot, hit: Element | null) {
  Object.defineProperty(root, "elementFromPoint", { configurable: true, value: vi.fn(() => hit) });
}

function ownUiHost() {
  const host = document.createElement("div");
  host.setAttribute(OWN_UI_ATTR, "");
  document.body.append(host);
  return host;
}

describe("elementAt", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
  });

  it("returns SVG elements instead of falling back", () => {
    const button = document.createElement("button");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    svg.append(rect);
    button.append(svg);
    document.body.append(button);
    stubHitStack(rect, svg, button, document.body);

    expect(elementAt(10, 10)).toBe(rect);
  });

  it("skips the extension's own UI and returns the page element underneath", () => {
    const host = ownUiHost();
    const page = document.createElement("button");
    document.body.append(page);
    stubHitStack(host, page, document.body);

    expect(elementAt(10, 10)).toBe(page);
  });

  it("descends into open shadow roots", () => {
    const outer = document.createElement("div");
    const outerRoot = outer.attachShadow({ mode: "open" });
    const inner = document.createElement("div");
    outerRoot.append(inner);
    const innerRoot = inner.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    innerRoot.append(button);
    document.body.append(outer);

    stubHitStack(outer, document.body);
    stubShadowHit(outerRoot, inner);
    stubShadowHit(innerRoot, button);

    expect(elementAt(10, 10)).toBe(button);
  });

  it("stops at a shadow host whose root reports the host itself or nothing", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    document.body.append(host);
    stubHitStack(host);

    stubShadowHit(root, host);
    expect(elementAt(10, 10)).toBe(host);

    stubShadowHit(root, null);
    expect(elementAt(10, 10)).toBe(host);
  });

  it("returns null outside the viewport", () => {
    stubHitStack();
    expect(elementAt(-5, -5)).toBeNull();
  });
});

describe("isOwnUi / isFromOwnUi", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("recognises the host and its light-DOM descendants", () => {
    const host = ownUiHost();
    const child = document.createElement("span");
    host.append(child);

    expect(isOwnUi(host)).toBe(true);
    expect(isOwnUi(child)).toBe(true);
    expect(isOwnUi(document.body)).toBe(false);
    expect(isOwnUi(window)).toBe(false);
    expect(isOwnUi(null)).toBe(false);
  });

  it("detects events dispatched inside the own UI's shadow root", () => {
    const host = ownUiHost();
    const toggle = document.createElement("input");
    host.attachShadow({ mode: "open" }).append(toggle);
    const page = document.createElement("button");
    document.body.append(page);

    const seen: boolean[] = [];
    const listening = new AbortController();
    window.addEventListener("pointerdown", (event) => seen.push(isFromOwnUi(event)), {
      capture: true,
      signal: listening.signal,
    });
    toggle.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    page.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    listening.abort();

    expect(seen).toEqual([true, false]);
  });
});

describe("closestHTMLElement", () => {
  it("returns the element itself or its nearest HTML ancestor", () => {
    const button = document.createElement("button");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.append(path);
    button.append(svg);

    expect(closestHTMLElement(button)).toBe(button);
    expect(closestHTMLElement(path)).toBe(button);
    expect(closestHTMLElement(null)).toBeNull();
  });
});

/**
 * happy-dom has no layout and does not expand the `overflow` shorthand, so set the
 * longhands and give the element explicit overflowing dimensions.
 */
function overflowing(el: HTMLElement, overflow = "auto") {
  el.style.overflowX = overflow;
  el.style.overflowY = overflow;
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 100 });
  return el;
}

function rootScroller() {
  return document.scrollingElement ?? document.documentElement;
}

describe("findScrollableAncestor", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("returns the viewport scroller for <html> instead of looping forever", () => {
    expect(findScrollableAncestor(document.documentElement)).toBe(rootScroller());
  });

  it("returns the viewport scroller, not <body>, when nothing nested scrolls", () => {
    const child = document.createElement("span");
    document.body.append(child);

    expect(findScrollableAncestor(child)).toBe(rootScroller());
    expect(findScrollableAncestor(document.body)).toBe(rootScroller());
  });

  it("returns the viewport scroller when there is no start element", () => {
    expect(findScrollableAncestor(undefined)).toBe(rootScroller());
    expect(findScrollableAncestor(null)).toBe(rootScroller());
  });

  it("returns the nearest overflowing scroll container", () => {
    const outer = overflowing(document.createElement("div"));
    const inner = overflowing(document.createElement("div"));
    const leaf = document.createElement("p");
    inner.append(leaf);
    outer.append(inner);
    document.body.append(outer);

    expect(findScrollableAncestor(leaf)).toBe(inner);
    expect(findScrollableAncestor(inner)).toBe(inner);
  });

  it("skips containers that can scroll but have no overflow", () => {
    const outer = overflowing(document.createElement("div"));
    const inner = document.createElement("div");
    inner.style.overflowY = "auto"; // scrollHeight === clientHeight
    const leaf = document.createElement("p");
    inner.append(leaf);
    outer.append(inner);
    document.body.append(outer);

    expect(findScrollableAncestor(leaf)).toBe(outer);
  });

  it("skips overflowing elements that clip instead of scrolling", () => {
    const clipped = overflowing(document.createElement("div"), "hidden");
    const leaf = document.createElement("p");
    clipped.append(leaf);
    document.body.append(clipped);

    expect(findScrollableAncestor(leaf)).toBe(rootScroller());
  });

  it("walks out of a shadow root to the host's ancestors", () => {
    const scroller = overflowing(document.createElement("div"));
    const host = document.createElement("div");
    const leaf = document.createElement("p");
    host.attachShadow({ mode: "open" }).append(leaf);
    scroller.append(host);
    document.body.append(scroller);

    expect(findScrollableAncestor(leaf)).toBe(scroller);
  });

  it("returns the viewport scroller for a detached element", () => {
    const detached = document.createElement("div");
    detached.append(document.createElement("p"));

    expect(findScrollableAncestor(detached.firstElementChild)).toBe(rootScroller());
  });
});
