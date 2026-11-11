import type { ApplyResult, Viewport } from "../shared/types";

/**
 * Largest difference, per dimension, still treated as the same viewport. Fixed-pixel UI
 * (like a centred debug panel) shifts with any real difference, so this only absorbs
 * rounding.
 */
export const VIEWPORT_TOLERANCE_PX = 1;

export function currentViewport(): Viewport {
  return { w: window.innerWidth, h: window.innerHeight };
}

/**
 * Whether a sender's viewport matches this frame's closely enough for a mirrored position
 * to land on the same element. Messages without a viewport (older builds) are trusted.
 */
export function viewportMatches(sender: Viewport | undefined): boolean {
  if (!sender) return true;
  return (
    Math.abs(sender.w - window.innerWidth) <= VIEWPORT_TOLERANCE_PX &&
    Math.abs(sender.h - window.innerHeight) <= VIEWPORT_TOLERANCE_PX
  );
}

/** The answer for a message dropped because the viewports differ. */
export function viewportMismatch(): ApplyResult {
  return { status: "dropped", reason: "viewport-mismatch", viewport: currentViewport() };
}
