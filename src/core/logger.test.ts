import { describe, expect, it, vi } from "vite-plus/test";
import { createLogger } from "./logger";

describe("createLogger", () => {
  it("logs drops with their reason and inspectable details", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const element = document.createElement("div");

    createLogger("window-id").dropped("pointerdown", "box differs", element);

    expect(log).toHaveBeenCalledExactlyOnceWith(
      "%c[SYNC DROPPED]%c pointerdown: box differs",
      expect.stringContaining("color"),
      expect.any(String),
      element,
    );
  });
});
