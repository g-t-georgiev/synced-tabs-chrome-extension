import { describe, expect, it, vi } from "vite-plus/test";
import { getFramePath, splitFramePath } from "./frame-path";

type FakeWindow = { parent: FakeWindow; frames: FakeWindow[] };

function createWindow(parent?: FakeWindow): FakeWindow {
  const win = { frames: [] } as unknown as FakeWindow;
  win.parent = parent ?? win;
  parent?.frames.push(win);
  return win;
}

describe("getFramePath", () => {
  it("returns an empty path for the top frame", () => {
    expect(getFramePath()).toBe("");
  });

  it("returns child indices from the top window down", () => {
    const top = createWindow();
    createWindow(top);
    const child = createWindow(top);
    createWindow(child);
    const grandchild = createWindow(child);

    vi.stubGlobal("window", grandchild);

    expect(getFramePath()).toBe("1/1");
  });
});

describe("splitFramePath", () => {
  it("splits a child path into its parent's path and its index", () => {
    expect(splitFramePath("2")).toEqual({ parent: "", index: 2 });
    expect(splitFramePath("1/0")).toEqual({ parent: "1", index: 0 });
    expect(splitFramePath("1/0/3")).toEqual({ parent: "1/0", index: 3 });
  });

  it("returns null for the top frame and unknown positions", () => {
    expect(splitFramePath("")).toBeNull();
    expect(splitFramePath("1/-1")).toBeNull();
    expect(splitFramePath("x")).toBeNull();
  });
});
