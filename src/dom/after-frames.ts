/** Runs `fn` after `count` animation frames have rendered. Returns a cancel function. */
export function afterFrames(count: number, fn: () => void) {
  let frameId = 0;
  const tick = () => {
    if (--count > 0) frameId = requestAnimationFrame(tick);
    else fn();
  };
  frameId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frameId);
}
