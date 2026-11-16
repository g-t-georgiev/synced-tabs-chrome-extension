import { describe, expect, it } from "vite-plus/test";
import { fromEdgePosition, isEdgePosition, toEdgePosition } from "./panel-position";

const panel = { width: 150, height: 100 };
const wide = { width: 1920, height: 1080 };
const narrow = { width: 1280, height: 720 };

describe("edge positions", () => {
  it("keeps the nearest edges: top-right stays top-right", () => {
    const edge = toEdgePosition({ left: 1760, top: 10 }, panel, wide);

    // Offsets go to the panel's top-left corner, so they don't depend on its size.
    expect(edge).toEqual({ x: { edge: "right", offset: 160 }, y: { edge: "top", offset: 10 } });
    expect(fromEdgePosition(edge, narrow)).toEqual({ left: 1120, top: 10 });
  });

  it("keeps bottom-left at bottom-left", () => {
    const edge = toEdgePosition({ left: 10, top: 970 }, panel, wide);

    expect(edge).toEqual({ x: { edge: "left", offset: 10 }, y: { edge: "bottom", offset: 110 } });
    expect(fromEdgePosition(edge, narrow)).toEqual({ left: 10, top: 610 });
  });

  it("round-trips in the same window", () => {
    const position = { left: 400, top: 700 };
    expect(fromEdgePosition(toEdgePosition(position, panel, wide), wide)).toEqual(position);
  });

  it("restores the same corner whatever the panel's size is by then", () => {
    const edge = toEdgePosition({ left: 10, top: 970 }, panel, wide);
    // Same result as above, without knowing the panel's size: fonts may still be loading.
    expect(fromEdgePosition(edge, wide)).toEqual({ left: 10, top: 970 });
  });

  it("accepts only well-formed stored values", () => {
    expect(isEdgePosition({ x: { edge: "left", offset: 1 }, y: { edge: "top", offset: 2 } })).toBe(
      true,
    );
    expect(isEdgePosition({ left: 1, top: 2 })).toBe(false);
    expect(
      isEdgePosition({ x: { edge: "middle", offset: 1 }, y: { edge: "top", offset: 2 } }),
    ).toBe(false);
    expect(
      isEdgePosition({ x: { edge: "left", offset: NaN }, y: { edge: "top", offset: 2 } }),
    ).toBe(false);
    expect(isEdgePosition(null)).toBe(false);
  });
});
