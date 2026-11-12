import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { MessageController } from "../shared/types";
import { anchorAt } from "../dom";
import { createScrollSync } from "./scroll-sync";

function scrollMessage(isDocument: boolean, viewport = { w: 1280, h: 577 }) {
  return {
    action: ACTIONS.EXECUTE,
    originWindowId: "other",
    framePath: "",
    viewport,
    type: MESSAGE_TYPES.SCROLL_EVENT,
    isDocument,
    xRatio: 0,
    yRatio: 0.5,
    xPoint: 0.5,
    yPoint: 0.5,
  };
}

describe("createScrollSync: window size mismatch", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
  });

  afterEach(() => {
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  it("drops scrolls of inner containers, which are found by position", () => {
    const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
    const scrollTo = vi.spyOn(Element.prototype, "scrollTo");

    const result = createScrollSync({ transport }).apply(scrollMessage(false));

    expect(result).toMatchObject({ status: "dropped", reason: "viewport-mismatch" });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("still applies page scrolls, which are ratios of the scroll range", () => {
    const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;

    const result = createScrollSync({ transport }).apply(scrollMessage(true));

    expect(result).toBeUndefined();
  });

  it("requests a report for inner-container scrolls only", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
    const addListener = vi.spyOn(window, "addEventListener");
    const stop = createScrollSync({ transport }).capture();
    // happy-dom doesn't propagate events from `document` to `window` the way Chrome does,
    // so call the capture listener directly with a trusted scroll event.
    const onScroll = addListener.mock.calls.find(([type]) => type === "scroll")![1] as (
      event: Event,
    ) => void;
    const inner = document.createElement("div");
    document.body.append(inner);

    /** Feeds a trusted scroll of `target` and renders the frame that broadcasts it. */
    const scroll = (target: EventTarget) => {
      onScroll({ isTrusted: true, target } as unknown as Event);
      frames.splice(0).forEach((callback) => callback(0));
    };
    // happy-dom's `document` fails `instanceof Document` (it passes in Chrome).
    scroll(Object.create(Document.prototype) as Document);
    scroll(inner);
    stop();
    inner.remove();

    expect(transport.broadcast.mock.calls.map((call) => call[1])).toEqual([
      undefined,
      { report: "Scrolls inside panels" },
    ]);
  });
});

describe("createScrollSync: different window size, same container", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  function reelList() {
    const list = document.createElement("div");
    list.className = "reel-list";
    const item = document.createElement("div");
    item.className = "item";
    list.append(item);
    document.body.append(list);
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 200,
    } as DOMRect);
    return { list, item };
  }

  it("scrolls the same inner container, found by identity", () => {
    const sender = reelList();
    const anchor = anchorAt(sender.list, 150, 100);
    sender.list.remove();
    const receiver = reelList();
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [receiver.item],
    });
    const scrollTo = vi.spyOn(receiver.list, "scrollTo");

    const result = createScrollSync({
      transport: { broadcast: vi.fn(), onRemote: vi.fn() },
    }).apply({ ...scrollMessage(false, { w: 1920, h: 1080 }), anchor });

    expect(result).toBeUndefined();
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it("sends an anchor for inner containers only", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
    const addListener = vi.spyOn(window, "addEventListener");
    const stop = createScrollSync({ transport }).capture();
    const onScroll = addListener.mock.calls.find(([type]) => type === "scroll")![1] as (
      event: Event,
    ) => void;
    const { list } = reelList();

    for (const target of [Object.create(Document.prototype) as Document, list]) {
      onScroll({ isTrusted: true, target } as unknown as Event);
      frames.splice(0).forEach((callback) => callback(0));
    }
    stop();

    const [page, inner] = transport.broadcast.mock.calls.map(([payload]) => payload);
    expect(page).not.toHaveProperty("anchor");
    expect(inner.anchor).toMatchObject({ rx: 0.5, ry: 0.5 });
  });
});
