const FADE_DELAY_MS = 800;

/** @typedef {number | null} FadeTimeoutHandle */

/** 
 * Generate the ghost cursor DOM element.
 * @returns {import("../constants").CursorController}
 */
export function createCursor() {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });

  /** @type {FadeTimeoutHandle} */
  let fadeHandle = null;

  host.style.cssText = [
    "position: fixed",
    "top: 0",
    "left: 0",
    "z-index: 2147483647",
    "pointer-events: none",
    "opacity: 0",
    "transform: translate(-50%, -50%)",
    "transition: opacity 0.2s ease-out",
  ].join("; ");

  shadow.innerHTML = `
      <style>
        .dot {
          display: block;
          width: 14px;
          height: 14px;
          background-color: rgba(0, 255, 255, 0.4);
          border: 2px solid #00ffff;
          border-radius: 50%;
          box-shadow: 0 0 8px rgba(0, 255, 255, 0.8);
        }
      </style>
      <div class="dot"></div>
    `;

  if (document.body) document.body.append(host);
  else window.addEventListener("DOMContentLoaded", () => document.body.append(host), { once: true });

  return {
    moveTo(x, y) {
      host.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      host.style.opacity = "1";
      // Fade out after 800ms of inactivity
      if (fadeHandle) clearTimeout(fadeHandle);
      fadeHandle = setTimeout(() => {
        host.style.opacity = "0";
      }, FADE_DELAY_MS);
    }
  };
}