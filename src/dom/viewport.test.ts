import { beforeEach, describe, expect, it } from "vite-plus/test";
import { currentViewport, viewportMatches, viewportMismatch } from "./viewport";

describe("viewport", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
    window.innerHeight = 720;
  });

  it("reports the frame's inner size", () => {
    expect(currentViewport()).toEqual({ w: 1280, h: 720 });
  });

  it("treats sizes within 1px as the same viewport", () => {
    expect(viewportMatches({ w: 1280, h: 720 })).toBe(true);
    expect(viewportMatches({ w: 1281, h: 719 })).toBe(true);
  });

  it("treats any larger difference in either dimension as a mismatch", () => {
    expect(viewportMatches({ w: 1282, h: 720 })).toBe(false);
    expect(viewportMatches({ w: 1280, h: 577 })).toBe(false); // DevTools docked below
  });

  it("trusts messages from older builds that carry no viewport", () => {
    expect(viewportMatches(undefined)).toBe(true);
  });

  it("describes a drop with the receiver's own viewport", () => {
    expect(viewportMismatch()).toEqual({
      status: "dropped",
      reason: "viewport-mismatch",
      viewport: { w: 1280, h: 720 },
    });
  });
});
