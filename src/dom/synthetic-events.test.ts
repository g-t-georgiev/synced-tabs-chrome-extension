import { afterEach, describe, expect, it } from "vite-plus/test";
import { dispatchSyntheticPointerEvent } from "./synthetic-events";

const PRESS = { button: 0, buttons: 1 };
const RELEASE = { button: 0, buttons: 0 };

/** Records every pointer/mouse event reaching `target`, with the fields we care about. */
function record(target: EventTarget) {
  const events: Array<Record<string, unknown>> = [];
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) {
    target.addEventListener(type, (event) => {
      const e = event as PointerEvent;
      events.push({
        type: e.type,
        ctor: e.constructor.name,
        button: e.button,
        buttons: e.buttons,
        detail: e.detail,
        pointerType: e.pointerType,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    });
  }
  return events;
}

/** Runs a full press on `el`: pointerdown, pointerup, click. */
function press(el: Element) {
  dispatchSyntheticPointerEvent(el, "pointerdown", 30, 40, PRESS);
  dispatchSyntheticPointerEvent(el, "pointerup", 30, 40, RELEASE);
  dispatchSyntheticPointerEvent(el, "click", 30, 40, RELEASE);
}

describe("dispatchSyntheticPointerEvent", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("fires pointer events with their compatibility mouse events, in browser order", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const events = record(button);

    press(button);

    expect(events.map((e) => e.type)).toEqual([
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ]);
    expect(events[0]).toMatchObject({
      ctor: "PointerEvent",
      button: 0,
      buttons: 1,
      detail: 0,
      pointerType: "mouse",
      clientX: 30,
      clientY: 40,
    });
    expect(events[1]).toMatchObject({ ctor: "MouseEvent", buttons: 1, detail: 1 });
    expect(events[4]).toMatchObject({ ctor: "PointerEvent", buttons: 0, detail: 1 });
  });

  it("passes through the pressed button", () => {
    const target = document.createElement("div");
    document.body.append(target);
    const events = record(target);

    dispatchSyntheticPointerEvent(target, "pointerdown", 0, 0, { button: 2, buttons: 2 });

    expect(events[0]).toMatchObject({ button: 2, buttons: 2 });
  });

  it("suppresses compatibility mouse events when pointerdown is cancelled", () => {
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    canvas.addEventListener("pointerdown", (event) => event.preventDefault());
    const events = record(canvas);

    press(canvas);
    expect(events.map((e) => e.type)).toEqual(["pointerdown", "pointerup", "click"]);

    // The suppression ends with the pointerup.
    const next = document.createElement("button");
    document.body.append(next);
    const nextEvents = record(next);
    press(next);
    expect(nextEvents.map((e) => e.type)).toContain("mousedown");
  });

  it("focuses the nearest focusable ancestor on pointerdown", () => {
    const button = document.createElement("button");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    button.append(icon);
    document.body.append(button);

    dispatchSyntheticPointerEvent(icon, "pointerdown", 0, 0, PRESS);

    expect(document.activeElement).toBe(button);
  });

  it("does not move focus on pointerup or click", () => {
    const input = document.createElement("input");
    const other = document.createElement("button");
    document.body.append(input, other);
    input.focus();

    dispatchSyntheticPointerEvent(other, "pointerup", 0, 0, RELEASE);
    dispatchSyntheticPointerEvent(other, "click", 0, 0, RELEASE);

    expect(document.activeElement).toBe(input);
  });

  it("blurs the focused field when pressing non-focusable space", () => {
    const input = document.createElement("input");
    const empty = document.createElement("div");
    document.body.append(input, empty);
    input.focus();

    dispatchSyntheticPointerEvent(empty, "pointerdown", 0, 0, PRESS);

    expect(document.activeElement).not.toBe(input);
  });

  it("moves focus after mousedown listeners have run", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    input.focus();
    let focusedDuringMousedown: Element | null = null;
    button.addEventListener("mousedown", () => (focusedDuringMousedown = document.activeElement));

    dispatchSyntheticPointerEvent(button, "pointerdown", 0, 0, PRESS);

    expect(focusedDuringMousedown).toBe(input);
    expect(document.activeElement).toBe(button);
  });

  it("does not move focus when mousedown is cancelled", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    document.body.append(input, button);
    input.focus();

    dispatchSyntheticPointerEvent(button, "pointerdown", 0, 0, PRESS);

    expect(document.activeElement).toBe(input);
  });

  it("still moves focus when only pointerdown is cancelled", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    document.body.append(input, button);
    input.focus();

    dispatchSyntheticPointerEvent(button, "pointerdown", 0, 0, PRESS);
    dispatchSyntheticPointerEvent(button, "pointerup", 0, 0, RELEASE);

    expect(document.activeElement).toBe(button);
  });
});
