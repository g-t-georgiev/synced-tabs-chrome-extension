export function elementAt(x: number, y: number, fallback?: HTMLElement) {
  const element = document.elementFromPoint(x, y);
  return element instanceof HTMLElement ? element : fallback;
}

const SCROLLABLE_OVERFLOW = /(auto|scroll)/;

/** Parent element, stepping out of a shadow root to its host. */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Whether `el` is a scroll container with content overflowing on either axis. */
function isScrollable(el: HTMLElement) {
  const style = getComputedStyle(el);
  const y = SCROLLABLE_OVERFLOW.test(style.overflowY) && el.scrollHeight > el.clientHeight;
  const x = SCROLLABLE_OVERFLOW.test(style.overflowX) && el.scrollWidth > el.clientWidth;
  return x || y;
}

/**
 * Nearest scroll container at or above `start`. Falls back to the viewport scroller
 * (`document.scrollingElement`), which is what moves the page; `<body>` and `<html>`
 * are never returned as nested containers.
 */
export function findScrollableAncestor(start?: Element | null): HTMLElement {
  const root = (document.scrollingElement ?? document.documentElement) as HTMLElement;

  for (let el = start ?? null; el; el = parentOf(el)) {
    if (el === document.body || el === document.documentElement) break;
    if (el instanceof HTMLElement && isScrollable(el)) return el;
  }

  return root;
}
