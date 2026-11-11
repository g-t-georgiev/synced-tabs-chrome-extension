import type {
  ApplyResult,
  BroadcastOptions,
  Feature,
  MessageController,
  PanelController,
  PanelDragPhase,
  PanelPosition,
  StateConfigKey,
} from "../shared/types";
import { MESSAGE_TYPES } from "../shared/constants";
import { rAfThrottle, viewportMatches, viewportMismatch } from "../dom";

type PanelSyncKey = Extract<StateConfigKey, "syncMouse">;
interface PanelDragPayload {
  type: string;
  phase: PanelDragPhase;
  /** Panel position in the sender's viewport, px. */
  left: number;
  top: number;
  /** Pointer position in the sender's viewport, px (viewports must match to follow). */
  xPoint: number;
  yPoint: number;
}

const PANEL_MISS: ApplyResult = { status: "dropped", reason: "panel-miss" };

/**
 * Mirrors dragging the panel by its handle. A panel in another tab follows only if its own
 * handle is under the same point when the drag starts, i.e. the panels were in the same
 * place; panels elsewhere stay put and the sender is told. Clicks on the panel are never
 * mirrored (toggles already sync through storage).
 *
 * Part of mouse sync: on and off with the "Mouse Events" toggle.
 */
export function createPanelSync({
  transport,
  panel,
}: {
  transport: MessageController;
  panel: PanelController;
}): Feature<PanelSyncKey, PanelDragPayload> {
  /** Whether this panel is following the remote drag in progress. */
  let following = false;

  return {
    configKey: "syncMouse",
    handles: [MESSAGE_TYPES.PANEL_DRAG],
    // A pulse per drag frame would just flicker; drops are reported to the sender instead.
    silent: true,

    capture() {
      const send = (
        phase: PanelDragPhase,
        position: PanelPosition,
        point: { x: number; y: number },
        options?: BroadcastOptions,
      ) => {
        transport.broadcast(
          {
            type: MESSAGE_TYPES.PANEL_DRAG,
            phase,
            left: position.left,
            top: position.top,
            xPoint: point.x,
            yPoint: point.y,
          },
          options,
        );
      };
      const sendMove = rAfThrottle(send);

      const stop = panel.onDrag((phase, position, point) => {
        if (phase === "move") {
          sendMove(phase, position, point);
          return;
        }
        // Start and end go out immediately; end carries the final position, so a move
        // still waiting for its frame is superseded.
        sendMove.cancel();
        send(phase, position, point, phase === "start" ? { report: "Panel moves" } : undefined);
      });

      return () => {
        stop();
        sendMove.cancel();
      };
    },

    apply(message) {
      if (message.phase === "start") {
        following = false;
        if (!viewportMatches(message.viewport)) return viewportMismatch();
        if (panel.hitTest(message.xPoint, message.yPoint) !== "handle") return PANEL_MISS;
        following = true;
      }

      if (!following) return;

      panel.setPosition({ left: message.left, top: message.top });
      if (message.phase === "end") following = false;
    },
  };
}
