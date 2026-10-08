/**
 * @param {number} clientX
 * @param {number} clientY
 */
export function pointToRatio(clientX, clientY) {
  const x = clientX / window.innerWidth;
  const y = clientY / window.innerHeight;
  return { x, y };
}

/**
 * @param {DOMRect} rect
 */
export function rectCenterToRatio(rect) {
  const x = rect.width ? (rect.left + rect.width / 2) / window.innerWidth : 0.5;
  const y = rect.height ? (rect.top + rect.height / 2) / window.innerHeight : 0.5;
  return { x, y };
}

/**
 * @param {HTMLElement} el
 */
export function scrollOffsetToRatio(el) {
  const maxX = el.scrollWidth - el.clientWidth;
  const maxY = el.scrollHeight - el.clientHeight;
  const x = maxX > 0 ? el.scrollLeft / maxX : 0;
  const y = maxY > 0 ? el.scrollTop / maxY : 0;
  return { x, y };
}

/**
 * @param {Element} el
 */
export function elementCenterToRatio(el) {
  const rect = el.getBoundingClientRect();
  const x = (rect.left + el.clientWidth / 2) / window.innerWidth;
  const y = (rect.top + el.clientHeight / 2) / window.innerHeight;
  return { x, y };
}

/**
 * @param {number} x
 * @param {number} y
 */
export function ratioToPoint(x, y) {
  return {
    x: x * window.innerWidth,
    y: y * window.innerHeight
  };
}

/**
 * @param {HTMLElement} target
 * @param {number} x
 * @param {number} y
 */
export function ratioToScrollOffset(target, x, y) {
  const maxX = target.scrollWidth - target.clientWidth;
  const maxY = target.scrollHeight - target.clientHeight;
  const left = x * maxX;
  const top = y * maxY;
  return { left, top };
}