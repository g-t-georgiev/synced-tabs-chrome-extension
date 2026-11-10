import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { afterFrames } from "./after-frames";
import { rAfThrottle } from "./raf-throttle";

let queue: Map<number, FrameRequestCallback>;

/** Runs every callback queued for the next animation frame. */
function flushFrame() {
  const pending = [...queue.values()];
  queue.clear();
  pending.forEach((callback) => callback(performance.now()));
}

beforeEach(() => {
  queue = new Map();
  let nextId = 1;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      const id = nextId++;
      queue.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => queue.delete(id)),
  );
});

describe("rAfThrottle", () => {
  it("invokes once per frame with the latest arguments", () => {
    const fn = vi.fn();
    const throttled = rAfThrottle(fn);

    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    flushFrame();
    expect(fn).toHaveBeenCalledExactlyOnceWith(3);

    throttled(4);
    flushFrame();
    expect(fn).toHaveBeenLastCalledWith(4);
  });

  it("cancel drops the pending call", () => {
    const fn = vi.fn();
    const throttled = rAfThrottle(fn);

    throttled(1);
    throttled.cancel();
    flushFrame();

    expect(fn).not.toHaveBeenCalled();
  });
});

describe("afterFrames", () => {
  it("runs the callback after the given number of frames", () => {
    const fn = vi.fn();
    afterFrames(3, fn);

    flushFrame();
    flushFrame();
    expect(fn).not.toHaveBeenCalled();

    flushFrame();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("can be cancelled mid-way", () => {
    const fn = vi.fn();
    const cancel = afterFrames(3, fn);

    flushFrame();
    cancel();
    flushFrame();
    flushFrame();

    expect(fn).not.toHaveBeenCalled();
  });
});
