/** Marks the host element of the extension's own UI (panel, ghost cursor, toasts). */
export const OWN_UI_ATTR = "data-mirror-sync-ui";

/** Whether `node` is, or sits inside, one of the extension's own UI hosts (light DOM). */
export function isOwnUi(node: EventTarget | null | undefined): boolean {
  return node instanceof Element && node.closest(`[${OWN_UI_ATTR}]`) !== null;
}

/** Whether an event started inside the extension's own UI, including inside its shadow roots. */
export function isFromOwnUi(event: Event): boolean {
  return event.composedPath().some(isOwnUi);
}

/**
 * Deepest page element at a viewport point, the same element a real click would target:
 * - the extension's own UI is skipped, so a point covered by this tab's panel resolves to
 *   the page element underneath it;
 * - open shadow roots are descended into;
 * - any `Element` is returned, so an SVG icon is the target and the event bubbles to the
 *   button that owns it.
 */
export function elementAt(x: number, y: number): Element | null {
  let element = document.elementsFromPoint(x, y).find((candidate) => !isOwnUi(candidate)) ?? null;

  while (element?.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }

  return element;
}

/** `el` itself if it is an `HTMLElement`, otherwise its nearest `HTMLElement` ancestor. */
export function closestHTMLElement(el: Element | null | undefined): HTMLElement | null {
  for (let current = el ?? null; current; current = parentOf(current)) {
    if (current instanceof HTMLElement) return current;
  }
  return null;
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
