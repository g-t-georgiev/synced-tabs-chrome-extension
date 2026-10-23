/** Coalesces calls to at most one invocation per animation frame. The most recent argument wins. */
export function rAfThrottle<TFunc extends ((...args: any[]) => any)>(fn: TFunc) {
  let frameId: number | null = null;
  let latestArgs: Parameters<TFunc> | null = null;

  function invoke() {
    const args = latestArgs;
    frameId = null;
    latestArgs = null;
    if (args) fn(...args);
  }

  function throttled(...args: Parameters<TFunc>) {
    latestArgs = args;
    if (frameId !== null) return;
    frameId = requestAnimationFrame(invoke);
  }

  throttled.cancel = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    latestArgs = null;
  };

  return throttled;
}