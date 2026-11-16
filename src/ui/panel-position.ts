import type { PanelPosition } from "../shared/types";

/**
 * Where the panel sits, relative to the viewport edges nearest to it, so a panel kept near
 * the right edge stays there in a wider or narrower window instead of drifting with a fixed
 * `left`. Offsets are measured to the panel's top-left corner (for the right and bottom
 * edges too), so the position doesn't depend on the panel's size, which changes while its
 * fonts load.
 */
export interface EdgePosition {
  x: { edge: "left" | "right"; offset: number };
  y: { edge: "top" | "bottom"; offset: number };
}

type Size = { width: number; height: number };

/** Storage key: one position for all tabs (they show the same app). */
export const PANEL_POSITION_KEY = "panelPosition";

/** The edges nearest to the panel at `position` (with `panel` size), and the offsets. */
export function toEdgePosition(position: PanelPosition, panel: Size, viewport: Size): EdgePosition {
  // Which edge is nearest uses the whole box; the offset is to the top-left corner.
  const nearRight = viewport.width - (position.left + panel.width) < position.left;
  const nearBottom = viewport.height - (position.top + panel.height) < position.top;
  return {
    x: nearRight
      ? { edge: "right", offset: viewport.width - position.left }
      : { edge: "left", offset: position.left },
    y: nearBottom
      ? { edge: "bottom", offset: viewport.height - position.top }
      : { edge: "top", offset: position.top },
  };
}

/** The panel's top-left corner for a saved edge position in this viewport. */
export function fromEdgePosition(saved: EdgePosition, viewport: Size): PanelPosition {
  return {
    left: saved.x.edge === "left" ? saved.x.offset : viewport.width - saved.x.offset,
    top: saved.y.edge === "top" ? saved.y.offset : viewport.height - saved.y.offset,
  };
}

/** Whether a stored value is a usable edge position (storage may hold anything). */
export function isEdgePosition(value: unknown): value is EdgePosition {
  const v = value as Partial<EdgePosition> | null | undefined;
  return (
    !!v &&
    (v.x?.edge === "left" || v.x?.edge === "right") &&
    Number.isFinite(v.x.offset) &&
    (v.y?.edge === "top" || v.y?.edge === "bottom") &&
    Number.isFinite(v.y.offset)
  );
}

/** The saved position, if any. Never throws (no extension context, storage errors). */
export async function loadPanelPosition(): Promise<EdgePosition | undefined> {
  try {
    const stored = await chrome.storage.local.get([PANEL_POSITION_KEY]);
    const value: unknown = stored[PANEL_POSITION_KEY];
    return isEdgePosition(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Saves the position for the next page load, in every tab. Never throws. */
export async function savePanelPosition(position: EdgePosition): Promise<void> {
  try {
    await chrome.storage.local.set({ [PANEL_POSITION_KEY]: position });
  } catch {
    // Extension reloaded or storage unavailable: the panel just starts top-right next time.
  }
}
