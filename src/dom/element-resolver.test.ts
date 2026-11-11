import { afterEach, describe, expect, it } from "vite-plus/test";
import { findScrollableAncestor } from "./element-resolver";

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
