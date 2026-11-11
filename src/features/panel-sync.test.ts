import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ACTIONS, MESSAGE_TYPES } from "../shared/constants";
import type {
  MessageController,
  PanelController,
  PanelDragListener,
  PanelDragPhase,
  PanelPart,
} from "../shared/types";
import { createPanelSync } from "./panel-sync";

function fakePanel(partAtPoint: PanelPart = "handle") {
  let dragListener: PanelDragListener | undefined;
  const panel = {
    flash: vi.fn(),
    pulse: vi.fn(),
    hitTest: vi.fn(() => partAtPoint),
    getPosition: vi.fn(() => ({ left: 0, top: 0 })),
    setPosition: vi.fn(),
    onDrag: vi.fn((listener: PanelDragListener) => {
      dragListener = listener;
      return () => (dragListener = undefined);
    }),
  } satisfies PanelController;
  const drag = (phase: PanelDragPhase, left: number, top: number) =>
    dragListener?.(phase, { left, top }, { x: left, y: top });
  return { panel, drag };
}

function dragMessage(
  phase: PanelDragPhase,
  left: number,
  top: number,
  viewport = { w: 1280, h: 720 },
) {
  return {
    action: ACTIONS.EXECUTE,
    originWindowId: "other",
    framePath: "",
    viewport,
    type: MESSAGE_TYPES.PANEL_DRAG,
    phase,
    left,
    top,
    xPoint: 800,
    yPoint: 10,
  };
}

const transport = () => ({ broadcast: vi.fn(), onRemote: vi.fn() }) satisfies MessageController;

describe("createPanelSync", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  describe("sending", () => {
    it("broadcasts start (with a report), throttled moves, and end", () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("cancelAnimationFrame", () => {});
      const t = transport();
      const { panel, drag } = fakePanel();
      const stop = createPanelSync({ transport: t, panel }).capture();

      drag("start", 800, 10);
      drag("move", 700, 50);
      drag("move", 600, 90); // same frame: only the latest goes out
      frames.splice(0).forEach((callback) => callback(0));
      drag("move", 500, 130); // pending when the drag ends: superseded by end
      drag("end", 400, 170);
      stop();

      expect(
        t.broadcast.mock.calls.map(([payload, options]) => [payload.phase, payload.left, options]),
      ).toEqual([
        ["start", 800, { report: "Panel moves" }],
        ["move", 600, undefined],
        ["end", 400, undefined],
      ]);
    });
  });

  describe("receiving", () => {
    it("follows a drag that starts on its own handle", () => {
      const { panel } = fakePanel("handle");
      const feature = createPanelSync({ transport: transport(), panel });

      expect(feature.apply(dragMessage("start", 800, 10))).toBeUndefined();
      feature.apply(dragMessage("move", 600, 90));
      feature.apply(dragMessage("end", 400, 170));

      expect(panel.hitTest).toHaveBeenCalledWith(800, 10);
      expect(panel.setPosition.mock.calls.map(([position]) => position)).toEqual([
        { left: 800, top: 10 },
        { left: 600, top: 90 },
        { left: 400, top: 170 },
      ]);
    });

    it.each<PanelPart>(["toggle", "body", null])(
      "stays put when the point is on %s instead of the handle",
      (part) => {
        const { panel } = fakePanel(part);
        const feature = createPanelSync({ transport: transport(), panel });

        expect(feature.apply(dragMessage("start", 800, 10))).toEqual({
          status: "dropped",
          reason: "panel-miss",
        });
        feature.apply(dragMessage("move", 600, 90));
        feature.apply(dragMessage("end", 400, 170));

        expect(panel.setPosition).not.toHaveBeenCalled();
      },
    );

    it("stays put when the window size differs", () => {
      const { panel } = fakePanel("handle");
      const feature = createPanelSync({ transport: transport(), panel });

      expect(feature.apply(dragMessage("start", 800, 10, { w: 1280, h: 577 }))).toMatchObject({
        status: "dropped",
        reason: "viewport-mismatch",
      });
      feature.apply(dragMessage("move", 600, 90, { w: 1280, h: 577 }));

      expect(panel.setPosition).not.toHaveBeenCalled();
    });

    it("stops following after the drag ends", () => {
      const { panel } = fakePanel("handle");
      const feature = createPanelSync({ transport: transport(), panel });

      feature.apply(dragMessage("start", 800, 10));
      feature.apply(dragMessage("end", 400, 170));
      feature.apply(dragMessage("move", 100, 100));

      expect(panel.setPosition).toHaveBeenCalledTimes(2);
    });
  });
});
