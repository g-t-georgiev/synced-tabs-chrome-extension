// Shows this frame's tree position (same algorithm as src/core/frame-path.ts)
// and logs scroll / pointer / key events it receives, so you can see which
// frame a synced message landed in.
function framePath() {
  const indices = [];
  let current = window;
  while (current !== current.parent) {
    const parent = current.parent;
    let index = -1;
    for (let i = 0; i < parent.frames.length; i++) {
      if (parent.frames[i] === current) {
        index = i;
        break;
      }
    }
    indices.unshift(index);
    current = parent;
  }
  return indices.join("/");
}

const path = framePath();
document.title = `frame "${path}"`;
document.querySelector("[data-path]").textContent = JSON.stringify(path);
const log = document.querySelector("[data-log]");
const write = (text) => {
  log.textContent = `${new Date().toLocaleTimeString()} ${text}\n${log.textContent}`.slice(0, 600);
};
addEventListener("scroll", () => write(`scroll y=${Math.round(scrollY)}`), { passive: true });
addEventListener("pointerdown", (e) =>
  write(`pointerdown ${e.clientX},${e.clientY} trusted=${e.isTrusted}`),
);
addEventListener("keydown", (e) => write(`keydown ${e.key} trusted=${e.isTrusted}`));
