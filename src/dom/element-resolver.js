/**
 * @param {number} x 
 * @param {number} y 
 * @param {Element?} fallback
 * @returns {Element | null}
 */
export function elementAt(x, y, fallback = null) {
  return document.elementFromPoint(x, y) ?? fallback;
}

/**
 * @param {Element?} elem
 */
export function findScrollableAncestor(elem) {
  // walk up to a scrollable ancestor if needed
  while (elem && elem !== document.body) {
    const style = getComputedStyle(elem);
    const canScroll =
      /(auto|scroll)/.test(style.overflowY) ||
      /(auto|scroll)/.test(style.overflowX);
    const hasYScroll = elem.scrollHeight > elem.clientHeight;
    const hasXScroll = elem.scrollWidth > elem.clientWidth;
    if (canScroll && (hasYScroll || hasXScroll)) break;
    elem = elem.parentElement;
  }

  return elem || document.documentElement;
}