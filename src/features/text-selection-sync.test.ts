import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { MessageController } from "../shared/types";
import { fingerprint } from "../dom";
import type { FieldHighlight } from "../ui/field-highlight";
import { createTextSelectionSync } from "./text-selection-sync";

const RECT = { left: 100, top: 200, width: 150, height: 20 };
let frames: FrameRequestCallback[];

function nextFrame() {
  frames.splice(0).forEach((callback) => callback(0));
}

function seedField(type = "text") {
  const el = document.createElement("input");
  el.type = type;
  el.className = "tp-txtv_i";
  el.value = "seed-123456";
  document.body.append(el);
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ ...RECT } as DOMRect);
  return el;
}

function hitOnly(el: Element) {
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [el] });
}

function setup() {
  const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
  const highlight = {
    show: vi.fn(),
    select: vi.fn(),
    hide: vi.fn(),
    field: null as Element | null,
  } satisfies FieldHighlight;
  const feature = createTextSelectionSync({ transport, highlight });
  return { transport, highlight, feature };
}

function selectionMessage(sender: Element, start: number, end: number) {
  return {
    action: ACTIONS.EXECUTE,
    originWindowId: "other",
    framePath: "",
    viewport: { w: 1280, h: 720 },
    type: MESSAGE_TYPES.TEXT_SELECTION,
    start,
    end,
    direction: "forward" as const,
    rect: RECT,
    fingerprint: fingerprint(sender),
  };
}

const selectionChanged = () => document.dispatchEvent(new Event("selectionchange"));

describe("createTextSelectionSync", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => frames.splice(0));
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  describe("sending", () => {
    // The tab the user is working in.
    beforeEach(() => {
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
    });

    it("sends the focused field's range once per frame, and only when it changes", () => {
      const { transport, feature } = setup();
      const stop = feature.capture();
      const field = seedField();
      field.focus();

      field.setSelectionRange(0, 4, "forward");
      selectionChanged();
      selectionChanged();
      nextFrame();
      selectionChanged(); // same range again
      nextFrame();
      field.setSelectionRange(2, 2);
      selectionChanged();
      nextFrame();
      stop();

      const ranges = transport.broadcast.mock.calls.map(([payload]) => [
        payload.start,
        payload.end,
      ]);
      expect(ranges).toEqual([
        [0, 4],
        [2, 2],
      ]);
      expect(transport.broadcast.mock.calls[0]![0]).toMatchObject({
        type: MESSAGE_TYPES.TEXT_SELECTION,
        direction: "forward",
        rect: RECT,
        fingerprint: fingerprint(field),
      });
    });

    it("ignores fields without a selection API and unfocused fields", () => {
      const { transport, feature } = setup();
      const stop = feature.capture();
      const number = seedField("number");
      number.focus();
      selectionChanged();
      nextFrame();

      number.blur();
      seedField(); // not focused
      selectionChanged();
      nextFrame();
      stop();

      expect(transport.broadcast).not.toHaveBeenCalled();
    });

    it("does not send back a range it set from another tab", () => {
      const { transport, feature } = setup();
      const sender = seedField();
      sender.remove();
      const field = seedField();
      hitOnly(field);
      const stop = feature.capture();
      field.focus();
      selectionChanged();
      nextFrame();
      transport.broadcast.mockClear();

      feature.apply(selectionMessage(sender, 1, 5));
      selectionChanged(); // the echo of setSelectionRange
      nextFrame();
      stop();

      expect(transport.broadcast).not.toHaveBeenCalled();
    });
  });

  describe("receiving", () => {
    // Another tab, not the one the user is working in.
    beforeEach(() => {
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
    });

    it("sets the range on the identical field and draws it", () => {
      const { highlight, feature } = setup();
      const sender = seedField();
      sender.remove();
      const field = seedField();
      hitOnly(field);

      expect(feature.apply(selectionMessage(sender, 2, 6))).toBeUndefined();

      expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6]);
      expect(highlight.show).toHaveBeenCalledWith(field);
      expect(highlight.select).toHaveBeenCalledWith(2, 6);
    });

    it("clamps the range to this field's value", () => {
      const { highlight, feature } = setup();
      const sender = seedField();
      const field = seedField();
      field.value = "abc";
      hitOnly(field);

      feature.apply(selectionMessage(sender, 1, 50));

      expect(highlight.select).toHaveBeenCalledWith(1, 3);
    });

    it("draws nothing when no identical field is there", () => {
      const { highlight, feature } = setup();
      const sender = seedField();
      const other = seedField();
      other.classList.add("tp-numv_i");
      hitOnly(other);

      expect(feature.apply(selectionMessage(sender, 0, 2))).toMatchObject({
        reason: "field-mismatch",
      });
      expect(highlight.select).not.toHaveBeenCalled();
    });
  });
});

describe("createTextSelectionSync: only the tab being worked in counts", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => frames.splice(0));
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  it("doesn't send selection changes from a tab without focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { transport, feature } = setup();
    const stop = feature.capture();
    const field = seedField();
    field.focus(); // a mirrored click's focus()

    field.setSelectionRange(11, 11); // a mirrored value moved the caret to the end
    selectionChanged();
    nextFrame();
    stop();

    expect(transport.broadcast).not.toHaveBeenCalled();
  });

  it("sends the current range when a field gains focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { transport, feature } = setup();
    const stop = feature.capture();
    const field = seedField();
    field.setSelectionRange(4, 4);

    field.focus(); // also when the window regains focus
    nextFrame();
    stop();

    expect(transport.broadcast).toHaveBeenCalledOnce();
    expect(transport.broadcast.mock.calls[0]![0]).toMatchObject({ start: 4, end: 4 });
  });

  it("reads the caret after typing even without a selectionchange", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { transport, feature } = setup();
    const stop = feature.capture();
    const field = seedField();
    field.focus();
    nextFrame();

    field.setSelectionRange(6, 6); // the caret after typing a character
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    nextFrame();
    field.setSelectionRange(7, 7);
    field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
    nextFrame();
    stop();

    const carets = transport.broadcast.mock.calls.map(([payload]) => payload.start);
    expect(carets.slice(-2)).toEqual([6, 7]);
  });

  it("never moves the caret of the field being typed in", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { highlight, feature } = setup();
    const sender = seedField();
    sender.remove();
    const field = seedField();
    hitOnly(field);
    field.focus();
    field.setSelectionRange(3, 3);

    feature.apply(selectionMessage(sender, 0, 11));

    expect([field.selectionStart, field.selectionEnd]).toEqual([3, 3]);
    expect(highlight.select).not.toHaveBeenCalled();
    expect(highlight.hide).toHaveBeenCalled();
  });
});
