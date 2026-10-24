export function elementAt(x: number, y: number, fallback?: HTMLElement) {
  const element = document.elementFromPoint(x, y);
  return element instanceof HTMLElement ? element : fallback;
}

export function findScrollableAncestor(elem?: HTMLElement) {
  // walk up to a scrollable ancestor if needed
  while (elem && elem !== document.body) {
    const style = getComputedStyle(elem);
    const canScroll =
      /(auto|scroll)/.test(style.overflowY) ||
      /(auto|scroll)/.test(style.overflowX);
    const hasYScroll = elem.scrollHeight > elem.clientHeight;
    const hasXScroll = elem.scrollWidth > elem.clientWidth;

    if (canScroll && (hasYScroll || hasXScroll)) break;

    const parent = elem.parentElement;
    if (parent) elem = parent;
  }

  return elem || document.documentElement;
}