import type { EdgePosition, PanelPosition } from "../shared/types";

export type { EdgePosition };

type Size = { width: number; height: number };

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
