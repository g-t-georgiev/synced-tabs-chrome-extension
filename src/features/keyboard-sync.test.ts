import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { KeyboardEventData, MessageController } from "../shared/types";
import { anchorAt } from "../dom";
import { createKeyboardSync } from "./keyboard-sync";

function keyMessage(subType: string, code: string, repeat = false) {
  const keyData: KeyboardEventData = {
    key: code,
    code,
    keyCode: 0,
    which: 0,
    charCode: 0,
    bubbles: true,
    cancelable: true,
    composed: true,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    repeat,
  };
  return {
    action: ACTIONS.EXECUTE,
    originWindowId: "other",
    framePath: "",
    type: MESSAGE_TYPES.KEY_EVENT,
    subType,
    keyData,
    xRatio: 0.5,
    yRatio: 0.5,
  };
}

function setup() {
  const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
  const logger = { initialized: vi.fn(), remote: vi.fn(), execute: vi.fn(), dropped: vi.fn() };
  return createKeyboardSync({ transport, logger });
}

/** Points hit-testing at whichever element `current` holds. */
function stubHit() {
  const hit: { current: Element | null } = { current: null };
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => (hit.current ? [hit.current] : []),
  });
  return hit;
}

/** Records `<type>:<code>` for key events reaching `el`. */
function record(el: Element, into: string[], name: string) {
  for (const type of ["keydown", "keyup"]) {
    el.addEventListener(type, (e) => into.push(`${name} ${type}:${(e as KeyboardEvent).code}`));
  }
}

describe("createKeyboardSync", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
  });

  it("keeps each held key on its own target when keys overlap", () => {
    const feature = setup();
    const hit = stubHit();
    const first = document.createElement("input");
    const second = document.createElement("input");
    document.body.append(first, second);
    const seen: string[] = [];
    record(first, seen, "first");
    record(second, seen, "second");

    hit.current = first;
    feature.apply(keyMessage("keydown", "ShiftLeft"));
    hit.current = second;
    feature.apply(keyMessage("keydown", "KeyA"));
    feature.apply(keyMessage("keyup", "ShiftLeft")); // must still reach `first`
    feature.apply(keyMessage("keyup", "KeyA"));

    expect(seen).toEqual([
      "first keydown:ShiftLeft",
      "second keydown:KeyA",
      "first keyup:ShiftLeft",
      "second keyup:KeyA",
    ]);
  });

  it("sends auto-repeat keydowns to the key's original target", () => {
    const feature = setup();
    const hit = stubHit();
    const field = document.createElement("input");
    const other = document.createElement("button");
    document.body.append(field, other);
    const seen: string[] = [];
    record(field, seen, "field");
    record(other, seen, "other");

    hit.current = field;
    feature.apply(keyMessage("keydown", "Space"));
    hit.current = other;
    feature.apply(keyMessage("keydown", "Space", true));
    feature.apply(keyMessage("keyup", "Space"));

    expect(seen).toEqual(["field keydown:Space", "field keydown:Space", "field keyup:Space"]);
  });

  it("resolves a fresh target for a keyup whose keydown it never saw", () => {
    const feature = setup();
    const hit = stubHit();
    const field = document.createElement("input");
    document.body.append(field);
    const seen: string[] = [];
    record(field, seen, "field");

    hit.current = field;
    feature.apply(keyMessage("keyup", "KeyZ"));

    expect(seen).toEqual(["field keyup:KeyZ"]);
  });

  it("focuses the target on keydown only", () => {
    const feature = setup();
    const hit = stubHit();
    const field = document.createElement("input");
    const other = document.createElement("input");
    document.body.append(field, other);

    hit.current = other;
    feature.apply(keyMessage("keyup", "KeyQ"));
    expect(document.activeElement).not.toBe(other);

    hit.current = field;
    feature.apply(keyMessage("keydown", "KeyQ"));
    expect(document.activeElement).toBe(field);
  });
});

describe("createKeyboardSync: window size mismatch", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
  });

  it("sends keys to the focused element instead of the element at the point", () => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
    const feature = setup();
    const hit = stubHit();
    const focused = document.createElement("input");
    const atPoint = document.createElement("input");
    document.body.append(focused, atPoint);
    focused.focus();
    hit.current = atPoint;
    const seen: string[] = [];
    record(focused, seen, "focused");
    record(atPoint, seen, "atPoint");

    const result = feature.apply({
      ...keyMessage("keydown", "Space"),
      viewport: { w: 1100, h: 720 },
    });

    expect(seen).toEqual(["focused keydown:Space"]);
    expect(result).toBeUndefined(); // still applied
  });
});

describe("createKeyboardSync: Enter and Space default actions (step 17)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  /** A key message whose sender's key went to `sentTo` (its anchor), or to the page. */
  function keyEvent(subType: string, code: "Enter" | "Space", sentTo?: Element) {
    const message = keyMessage(subType, code);
    return {
      ...message,
      keyData: { ...message.keyData, key: code === "Space" ? " " : "Enter" },
      ...(sentTo ? { anchor: anchorAt(sentTo, 0, 0) } : {}),
    };
  }

  it("presses the button a mirrored Enter lands on", () => {
    const feature = setup();
    const hit = stubHit();
    const button = document.createElement("button");
    document.body.append(button);
    hit.current = button;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);

    feature.apply(keyEvent("keydown", "Enter", button));
    feature.apply(keyEvent("keyup", "Enter", button));

    expect(clicked).toHaveBeenCalledOnce();
  });

  it("leaves it alone when the page cancels the key", () => {
    const feature = setup();
    const hit = stubHit();
    const button = document.createElement("button");
    document.body.append(button);
    hit.current = button;
    button.addEventListener("keydown", (e) => e.preventDefault());
    const clicked = vi.fn();
    button.addEventListener("click", clicked);

    feature.apply(keyEvent("keydown", "Enter", button));

    expect(clicked).not.toHaveBeenCalled();
  });

  it("toggles a checkbox on Space's release, unless its press was cancelled", () => {
    const feature = setup();
    const hit = stubHit();
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.append(checkbox);
    hit.current = checkbox;

    feature.apply(keyEvent("keydown", "Space", checkbox));
    feature.apply(keyEvent("keyup", "Space", checkbox));
    expect(checkbox.checked).toBe(true);

    checkbox.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    feature.apply(keyEvent("keydown", "Space", checkbox));
    feature.apply(keyEvent("keyup", "Space", checkbox));
    expect(checkbox.checked).toBe(true); // unchanged
  });
});

describe("createKeyboardSync: defaults only on the sender's key target (review fixes)", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  function enter(subType: string, extra: Record<string, unknown> = {}) {
    const message = keyMessage(subType, "Enter");
    return { ...message, keyData: { ...message.keyData, key: "Enter" }, ...extra };
  }

  function clickCounter(el: Element) {
    const clicked = vi.fn();
    el.addEventListener("click", clicked);
    return clicked;
  }

  it("doesn't press a button that only happens to sit at the point (nothing focused there)", () => {
    const feature = setup();
    const hit = stubHit();
    const button = document.createElement("button");
    document.body.append(button);
    hit.current = button;
    const clicked = clickCounter(button);

    feature.apply(enter("keydown")); // the sender's key went to the page: no anchor

    expect(clicked).not.toHaveBeenCalled();
  });

  it("doesn't press a different element than the sender's", () => {
    const feature = setup();
    const hit = stubHit();
    const sendersButton = document.createElement("button");
    sendersButton.className = "spin";
    const other = document.createElement("button");
    other.className = "bet";
    document.body.append(sendersButton, other);
    const anchor = anchorAt(sendersButton, 0, 0);
    hit.current = other;
    const clicked = clickCounter(other);

    feature.apply(enter("keydown", { anchor }));

    expect(clicked).not.toHaveBeenCalled();
  });

  it("doesn't press the focused button when window sizes differ and it isn't the sender's", () => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
    const feature = setup();
    stubHit();
    const focused = document.createElement("button");
    focused.className = "bet";
    document.body.append(focused);
    focused.focus();
    const sendersField = document.createElement("input");
    document.body.append(sendersField);
    const anchor = anchorAt(sendersField, 0, 0);
    sendersField.remove();
    const clicked = clickCounter(focused);

    feature.apply(enter("keydown", { anchor, viewport: { w: 1920, h: 1080 } }));

    expect(clicked).not.toHaveBeenCalled();
  });

  it("isn't blocked by an earlier cancelled press whose keyup never arrived", () => {
    const feature = setup();
    const hit = stubHit();
    const button = document.createElement("button");
    document.body.append(button);
    hit.current = button;
    const anchor = anchorAt(button, 0, 0);
    const clicked = clickCounter(button);

    button.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    feature.apply(enter("keydown", { anchor })); // cancelled; its keyup is lost
    feature.apply(enter("keydown", { anchor })); // a fresh press, not cancelled

    expect(clicked).toHaveBeenCalledOnce();
  });
});
