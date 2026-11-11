import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { KeyboardEventData, MessageController } from "../shared/types";
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
  const logger = { initialized: vi.fn(), remote: vi.fn(), execute: vi.fn() };
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
