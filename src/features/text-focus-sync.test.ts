import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { MessageController } from "../shared/types";
import { OWN_UI_ATTR, fingerprint } from "../dom";
import type { FieldHighlight } from "../ui/field-highlight";
import { createTextFocusSync } from "./text-focus-sync";

const RECT = { left: 100, top: 200, width: 150, height: 20 };

function seedField() {
  const el = document.createElement("input");
  el.setAttribute("type", "text");
  el.className = "tp-txtv_i";
  document.body.append(el);
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ ...RECT } as DOMRect);
  return el;
}

function stubHit(...stack: Element[]) {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => stack,
  });
}

function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

function setup() {
  const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
  const highlight = { show: vi.fn(), hide: vi.fn(), field: null } satisfies FieldHighlight;
  const feature = createTextFocusSync({ transport, highlight });
  return { transport, highlight, feature };
}

function focusMessage(state: string, sender: Element, viewport = { w: 1280, h: 720 }) {
  return {
    action: ACTIONS.EXECUTE,
    originWindowId: "other",
    framePath: "",
    viewport,
    type: MESSAGE_TYPES.TEXT_FOCUS,
    state,
    rect: RECT,
    fingerprint: fingerprint(sender),
  };
}

describe("createTextFocusSync", () => {
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
    it("broadcasts focus and blur of a text field, without asking for a report", () => {
      const { transport, feature } = setup();
      const stop = feature.capture();
      const field = seedField();

      field.dispatchEvent(trusted(new FocusEvent("focusin", { bubbles: true, composed: true })));
      field.dispatchEvent(trusted(new FocusEvent("focusout", { bubbles: true, composed: true })));
      stop();

      expect(transport.broadcast.mock.calls).toEqual([
        [
          {
            type: MESSAGE_TYPES.TEXT_FOCUS,
            state: "focus",
            rect: RECT,
            fingerprint: fingerprint(field),
          },
        ],
        [
          {
            type: MESSAGE_TYPES.TEXT_FOCUS,
            state: "blur",
            rect: RECT,
            fingerprint: fingerprint(field),
          },
        ],
      ]);
    });

    it("ignores password fields, other elements, untrusted events and our own UI", () => {
      const { transport, feature } = setup();
      const stop = feature.capture();
      const focus = (el: Element, isTrusted = true) => {
        const event = new FocusEvent("focusin", { bubbles: true, composed: true });
        el.dispatchEvent(isTrusted ? trusted(event) : event);
      };

      const password = document.createElement("input");
      password.type = "password";
      const button = document.createElement("button");
      const host = document.createElement("div");
      host.setAttribute(OWN_UI_ATTR, "");
      const own = document.createElement("input");
      host.attachShadow({ mode: "open" }).append(own);
      document.body.append(password, button, host);

      focus(password);
      focus(button);
      focus(seedField(), false);
      focus(own);
      stop();

      expect(transport.broadcast).not.toHaveBeenCalled();
    });

    it("removes this tab's ring when the user focuses something here", () => {
      const { highlight, feature } = setup();
      const stop = feature.capture();
      const button = document.createElement("button");
      document.body.append(button);

      button.dispatchEvent(trusted(new FocusEvent("focusin", { bubbles: true, composed: true })));
      stop();

      expect(highlight.hide).toHaveBeenCalled();
    });

    it("removes the ring when text sync is turned off", () => {
      const { highlight, feature } = setup();
      const stop = feature.capture();

      stop();

      expect(highlight.hide).toHaveBeenCalledOnce();
    });
  });

  describe("receiving", () => {
    it("outlines the identical field on focus", () => {
      const { highlight, feature } = setup();
      const sender = seedField();
      const field = seedField();
      stubHit(field);

      expect(feature.apply(focusMessage("focus", sender))).toBeUndefined();

      expect(highlight.show).toHaveBeenCalledExactlyOnceWith(field);
    });

    it("draws nothing when no identical field is there", () => {
      const { highlight, feature } = setup();
      const sender = seedField();
      const other = seedField();
      other.classList.add("tp-numv_i");
      stubHit(other);

      expect(feature.apply(focusMessage("focus", sender))).toEqual({
        status: "dropped",
        reason: "field-mismatch",
      });
      expect(highlight.show).not.toHaveBeenCalled();
      expect(highlight.hide).toHaveBeenCalled();
    });

    it("draws nothing when the window size differs", () => {
      const { highlight, feature } = setup();
      const sender = seedField();
      stubHit(seedField());

      feature.apply(focusMessage("focus", sender, { w: 1280, h: 577 }));

      expect(highlight.show).not.toHaveBeenCalled();
    });

    it("removes the ring on blur, wherever the field is now", () => {
      const { highlight, feature } = setup();
      const sender = seedField();
      stubHit(); // nothing there anymore

      feature.apply(focusMessage("blur", sender));

      expect(highlight.hide).toHaveBeenCalledOnce();
    });
  });
});
