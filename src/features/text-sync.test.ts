import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { MessageController } from "../shared/types";
import { OWN_UI_ATTR, fingerprint } from "../dom";
import { createTextSync } from "./text-sync";

const RECT = { left: 100, top: 200, width: 150, height: 20 };

function stubRect(el: Element, rect = RECT) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
}

/** A Tweakpane-like text field: no id or name, identified by its classes. */
function seedField(rect = RECT) {
  const el = document.createElement("input");
  el.setAttribute("type", "text");
  el.className = "tp-txtv_i";
  document.body.append(el);
  stubRect(el, rect);
  return el;
}

function stubHit(...stack: Element[]) {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(() => stack),
  });
}

function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

const transport = () => ({ broadcast: vi.fn(), onRemote: vi.fn() }) satisfies MessageController;

function textMessage(subType: string, value: string, sender: HTMLElement, overrides = {}) {
  return {
    action: ACTIONS.EXECUTE,
    originWindowId: "other",
    framePath: "",
    viewport: { w: 1280, h: 720 },
    type: MESSAGE_TYPES.TEXT_INPUT,
    subType,
    value,
    rect: RECT,
    fingerprint: fingerprint(sender),
    ...overrides,
  };
}

describe("createTextSync", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  describe("sending", () => {
    it("broadcasts a field's value, box and identity on input and change", () => {
      const t = transport();
      const stop = createTextSync({ transport: t }).capture();
      const field = seedField();

      field.value = "seed-123";
      field.dispatchEvent(trusted(new Event("input", { bubbles: true, composed: true })));
      field.dispatchEvent(trusted(new Event("change", { bubbles: true, composed: true })));
      stop();

      expect(t.broadcast.mock.calls).toEqual([
        [
          {
            type: MESSAGE_TYPES.TEXT_INPUT,
            subType: "input",
            value: "seed-123",
            rect: RECT,
            fingerprint: fingerprint(field),
          },
          { report: "Text edits" },
        ],
        [
          expect.objectContaining({ subType: "change", value: "seed-123" }),
          { report: "Text edits" },
        ],
      ]);
    });

    it("never sends password fields, untrusted events, or our own UI", () => {
      const t = transport();
      const stop = createTextSync({ transport: t }).capture();

      const password = document.createElement("input");
      password.type = "password";
      password.value = "hunter2";
      document.body.append(password);
      password.dispatchEvent(trusted(new Event("input", { bubbles: true, composed: true })));

      const field = seedField();
      field.dispatchEvent(new Event("input", { bubbles: true, composed: true })); // untrusted

      const host = document.createElement("div");
      host.setAttribute(OWN_UI_ATTR, "");
      const own = document.createElement("input");
      host.attachShadow({ mode: "open" }).append(own);
      document.body.append(host);
      own.dispatchEvent(trusted(new Event("input", { bubbles: true, composed: true })));
      stop();

      expect(t.broadcast).not.toHaveBeenCalled();
    });

    it("finds fields inside open shadow roots", () => {
      const t = transport();
      const stop = createTextSync({ transport: t }).capture();
      const host = document.createElement("div");
      const field = document.createElement("textarea");
      host.attachShadow({ mode: "open" }).append(field);
      document.body.append(host);

      field.value = "inside";
      field.dispatchEvent(trusted(new Event("input", { bubbles: true, composed: true })));
      stop();

      expect(t.broadcast).toHaveBeenCalledWith(expect.objectContaining({ value: "inside" }), {
        report: "Text edits",
      });
    });
  });

  describe("receiving", () => {
    it("writes the value into the identical field and fires the same event", () => {
      const sender = seedField();
      sender.remove();
      const field = seedField();
      stubHit(field);
      const events: string[] = [];
      field.addEventListener("input", () => events.push(`input:${field.value}`));
      field.addEventListener("change", () => events.push(`change:${field.value}`));
      const feature = createTextSync({ transport: transport() });

      expect(feature.apply(textMessage("input", "seed-123", sender))).toBeUndefined();
      expect(feature.apply(textMessage("change", "seed-123", sender))).toBeUndefined();

      expect(field.value).toBe("seed-123");
      expect(events).toEqual(["input:seed-123", "change:seed-123"]);
    });

    it("hit-tests at the centre of the sender's field", () => {
      const sender = seedField();
      const hit = vi.fn(() => [sender]);
      Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: hit });

      createTextSync({ transport: transport() }).apply(textMessage("input", "x", sender));

      expect(hit).toHaveBeenCalledWith(175, 210);
    });

    it.each<[string, (field: HTMLInputElement) => void]>([
      ["has other classes", (field) => field.classList.add("tp-numv_i")],
      ["has an id the sender's lacks", (field) => (field.id = "other")],
      ["is a different kind of input", (field) => field.setAttribute("type", "number")],
    ])("drops the value when the field at that spot %s", (_label, change) => {
      const sender = seedField();
      const field = seedField();
      change(field);
      stubHit(field);

      const result = createTextSync({ transport: transport() }).apply(
        textMessage("input", "seed-123", sender),
      );

      expect(result).toEqual({ status: "dropped", reason: "field-mismatch" });
      expect(field.value).toBe("");
    });

    it("drops the value when the identical field sits more than 1px elsewhere", () => {
      const sender = seedField();
      const field = seedField({ ...RECT, top: RECT.top + 2 });
      stubHit(field);

      const result = createTextSync({ transport: transport() }).apply(
        textMessage("input", "seed-123", sender),
      );

      expect(result).toEqual({ status: "dropped", reason: "field-mismatch" });
      expect(field.value).toBe("");
    });

    it("drops the value when something else covers that spot", () => {
      const sender = seedField();
      const cover = document.createElement("div");
      document.body.append(cover);
      stubHit(cover);

      expect(
        createTextSync({ transport: transport() }).apply(textMessage("input", "x", sender)),
      ).toEqual({ status: "dropped", reason: "field-mismatch" });
    });

    it("drops the value when the window size differs", () => {
      const sender = seedField();
      const field = seedField();
      stubHit(field);

      const result = createTextSync({ transport: transport() }).apply(
        textMessage("input", "seed-123", sender, { viewport: { w: 1280, h: 577 } }),
      );

      expect(result).toMatchObject({ status: "dropped", reason: "viewport-mismatch" });
      expect(field.value).toBe("");
    });
  });
});

describe("createTextSync: input event details", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  /** Applies `message` to an identical field and returns the events it received. */
  function receive(overrides: Record<string, unknown>, subType = "input") {
    const sender = seedField();
    const field = seedField();
    stubHit(field);
    const events: Event[] = [];
    field.addEventListener("input", (event) => events.push(event));
    field.addEventListener("change", (event) => events.push(event));

    createTextSync({ transport: transport() }).apply(
      textMessage(subType, "pasted seed", sender, overrides),
    );
    return events;
  }

  it("sends the InputEvent's inputType and data", () => {
    const t = transport();
    const stop = createTextSync({ transport: t }).capture();
    const field = seedField();

    field.value = "pasted seed";
    field.dispatchEvent(
      trusted(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertFromPaste",
          data: "pasted seed",
        }),
      ),
    );
    stop();

    expect(t.broadcast.mock.calls[0]![0]).toMatchObject({
      inputType: "insertFromPaste",
      data: "pasted seed",
    });
  });

  it("fires an InputEvent with the sender's inputType and data", () => {
    const [event] = receive({ inputType: "insertFromPaste", data: "pasted seed" });

    expect(event).toBeInstanceOf(InputEvent);
    expect(event).toMatchObject({
      type: "input",
      inputType: "insertFromPaste",
      data: "pasted seed",
      bubbles: true,
      composed: true,
    });
  });

  // happy-dom turns `data: null` into "" (Chrome keeps null), so data isn't asserted here.
  it("passes deletions through", () => {
    const [event] = receive({ inputType: "deleteContentBackward", data: null });

    expect(event).toMatchObject({ inputType: "deleteContentBackward" });
  });

  it("assumes typing for messages from older builds without inputType", () => {
    const [event] = receive({});

    expect(event).toBeInstanceOf(InputEvent);
    expect(event).toMatchObject({ inputType: "insertText" });
  });

  it("fires change as a plain event that stays inside its shadow root", () => {
    const [event] = receive({}, "change");

    expect(event).not.toBeInstanceOf(InputEvent);
    expect(event).toMatchObject({ type: "change", bubbles: true, composed: false });
  });

  it("fires a plain input event for a <select>, like the browser", () => {
    const sender = document.createElement("select");
    sender.className = "tp-lstv_s";
    for (const value of ["a", "b"]) {
      const option = document.createElement("option");
      option.value = value;
      sender.append(option);
    }
    const field = sender.cloneNode(true) as HTMLSelectElement;
    document.body.append(field);
    stubRect(sender);
    stubRect(field);
    stubHit(field);
    const events: Event[] = [];
    field.addEventListener("input", (event) => events.push(event));

    createTextSync({ transport: transport() }).apply(textMessage("input", "b", sender));

    expect(field.value).toBe("b");
    expect(events).toHaveLength(1);
    expect(events[0]).not.toBeInstanceOf(InputEvent);
  });
});

describe("createTextSync: different window size", () => {
  beforeEach(() => {
    window.innerWidth = 1280; // the sender's window is 1920×1080: everything at 2/3
    window.innerHeight = 720;
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
    vi.restoreAllMocks();
  });

  const fromBigWindow = { viewport: { w: 1920, h: 1080 } };

  it("writes into the same field when the layout scaled with the window", () => {
    const sender = seedField();
    sender.remove();
    const field = seedField({ left: 66.7, top: 133.3, width: 100, height: 13.3 }); // RECT × 2/3
    stubHit(field);

    const result = createTextSync({ transport: transport() }).apply(
      textMessage("input", "seed-123", sender, fromBigWindow),
    );

    expect(result).toBeUndefined();
    expect(field.value).toBe("seed-123");
  });

  it("drops fixed-pixel fields, which don't scale, as a size mismatch", () => {
    const sender = seedField();
    const field = seedField(); // same pixel box in the smaller window
    stubHit(field);

    const result = createTextSync({ transport: transport() }).apply(
      textMessage("input", "seed-123", sender, fromBigWindow),
    );

    expect(result).toMatchObject({ status: "dropped", reason: "viewport-mismatch" });
    expect(field.value).toBe("");
  });
});
