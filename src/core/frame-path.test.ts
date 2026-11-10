import { describe, expect, it, vi } from "vite-plus/test";
import { getFramePath } from "./frame-path";

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
