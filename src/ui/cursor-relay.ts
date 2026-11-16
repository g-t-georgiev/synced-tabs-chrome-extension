import type { CursorController, CursorRelayMessage } from "../shared/types";
import { ACTIONS } from "../shared/constants";
import { getFramePath, splitFramePath } from "../core/frame-path";
import { frameContentOffset } from "../dom/frame-offset";

/**
 * The ghost cursor for a child frame. The only real cursor lives in the top frame, so a
 * point here is handed to the parent frame (through the worker, invisible to page scripts),
 * which shifts it by this frame's position and passes it on, until the top frame draws it.
 */
export function createRelayCursor(): CursorController {
  return {
    moveTo(x, y) {
      const message: CursorRelayMessage = {
        action: ACTIONS.CURSOR_RELAY,
        fromPath: getFramePath(),
        x,
        y,
      };
      try {
        chrome.runtime.sendMessage(message).catch(() => {});
      } catch {
        // Extension context gone (extension reloaded): nothing to draw with.
      }
    },
  };
}

/**
 * Picks up points relayed from this frame's direct children, converts them into this
 * frame's viewport, and moves `cursor`: the real cursor in the top frame, or a relay
 * cursor in a child frame, which hands the point one level further up.
 */
export function listenForCursorRelays(
  cursor: CursorController,
  /** Where child frame `index` starts inside this viewport (overridable for tests). */
  offsetOfChild: (index: number) => { x: number; y: number } | null = (index) =>
    frameContentOffset(window.frames[index]),
) {
  const listener = (message: Partial<CursorRelayMessage> | undefined) => {
    if (message?.action !== ACTIONS.CURSOR_RELAY || typeof message.fromPath !== "string") return;
    if (typeof message.x !== "number" || typeof message.y !== "number") return;

    const from = splitFramePath(message.fromPath);
    // Only the sending frame's parent handles it; the worker delivers it to every frame.
    if (!from || from.parent !== getFramePath()) return;

    const offset = offsetOfChild(from.index);
    if (!offset) return;

    cursor.moveTo(message.x + offset.x, message.y + offset.y);
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
