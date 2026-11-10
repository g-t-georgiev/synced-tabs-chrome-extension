import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  pointToRatio,
  ratioToPoint,
  ratioToScrollOffset,
  rectCenterToRatio,
  scrollOffsetToRatio,
} from "./coordinates";

function scrollable(size: {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  scrollLeft?: number;
  scrollTop?: number;
}) {
  return { scrollLeft: 0, scrollTop: 0, ...size } as HTMLElement;
}

describe("coordinates", () => {
  beforeEach(() => {
    window.innerWidth = 1000;
    window.innerHeight = 500;
  });

  it("converts between viewport points and ratios", () => {
    expect(pointToRatio(250, 100)).toEqual({ x: 0.25, y: 0.2 });
    expect(ratioToPoint(0.25, 0.2)).toEqual({ x: 250, y: 100 });
  });

  it("maps a rect center to a ratio, defaulting empty dimensions to the middle", () => {
    expect(rectCenterToRatio({ left: 100, top: 50, width: 200, height: 100 })).toEqual({
      x: 0.2,
      y: 0.2,
    });
    expect(rectCenterToRatio({ left: 100, top: 50, width: 0, height: 0 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });

  it("converts scroll offsets to ratios and back", () => {
    const el = scrollable({
      scrollWidth: 300,
      clientWidth: 100,
      scrollLeft: 50,
      scrollHeight: 1000,
      clientHeight: 200,
      scrollTop: 400,
    });

    expect(scrollOffsetToRatio(el)).toEqual({ x: 0.25, y: 0.5 });
    expect(ratioToScrollOffset(el, 0.25, 0.5)).toEqual({ left: 50, top: 400 });
  });

  it("treats non-scrollable axes as ratio 0", () => {
    const el = scrollable({
      scrollWidth: 100,
      clientWidth: 100,
      scrollHeight: 50,
      clientHeight: 200,
    });

    expect(scrollOffsetToRatio(el)).toEqual({ x: 0, y: 0 });
  });
});
