import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type { MessageController } from "../shared/types";
import { createPointerSync } from "./pointer-sync";

function setup() {
  const transport = { broadcast: vi.fn(), onRemote: vi.fn() } satisfies MessageController;
  const logger = { initialized: vi.fn(), remote: vi.fn(), execute: vi.fn() };
  const feature = createPointerSync({ transport, logger });
  return { transport, feature };
}

/** happy-dom events are untrusted; the capture path only accepts trusted ones. */
function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

describe("createPointerSync", () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (document as Partial<Document>).elementsFromPoint;
  });

  it("broadcasts the pressed button state with the position", () => {
    const { transport, feature } = setup();
    const stop = feature.capture();

    window.dispatchEvent(
      trusted(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, button: 2, buttons: 2 })),
    );
    stop();

    expect(transport.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MESSAGE_TYPES.POINTER_EVENT,
        subType: "pointerdown",
        button: 2,
        buttons: 2,
      }),
    );
  });

  it("replays a message as a pointer event with its compatibility mouse event", () => {
    const { feature } = setup();
    const target = document.createElement("button");
    document.body.append(target);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target],
    });
    const seen: string[] = [];
    target.addEventListener("pointerdown", (e) =>
      seen.push(`${e.type}:${(e as MouseEvent).buttons}`),
    );
    target.addEventListener("mousedown", (e) =>
      seen.push(`${e.type}:${(e as MouseEvent).buttons}`),
    );

    feature.apply({
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType: "pointerdown",
      xRatio: 0.5,
      yRatio: 0.5,
      button: 0,
      buttons: 1,
    });

    expect(seen).toEqual(["pointerdown:1", "mousedown:1"]);
  });

  it("treats messages without button state as a primary-button press", () => {
    const { feature } = setup();
    const target = document.createElement("button");
    document.body.append(target);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [target],
    });
    const seen: number[] = [];
    target.addEventListener("pointerdown", (e) => seen.push((e as MouseEvent).buttons));

    feature.apply({
      action: ACTIONS.EXECUTE,
      originWindowId: "other",
      framePath: "",
      type: MESSAGE_TYPES.POINTER_EVENT,
      subType: "pointerdown",
      xRatio: 0.5,
      yRatio: 0.5,
    });

    expect(seen).toEqual([1]);
  });
});
