/**
 * Coalesces calls to at most one invocation per animation frame. The most recent argument wins.
 *
 * @template {Function} TFunc
 * @param {TFunc} fn
 */
export function rAfThrottle(fn) {
  let frameId = null;
  let latestArgs = null;

  function invoke() {
    const args = latestArgs;
    frameId = null;
    latestArgs = null;
    fn(...args);
  }

  /** @param {Parameters<TFunc>} args */
  function throttled(...args) {
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