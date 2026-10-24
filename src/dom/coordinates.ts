export function pointToRatio(clientX: number, clientY: number) {
  const x = clientX / window.innerWidth;
  const y = clientY / window.innerHeight;
  return { x, y };
}

export function rectCenterToRatio(rect: Pick<DOMRect, "left" | "top" | "width" | "height">) {
  const x = rect.width ? (rect.left + rect.width / 2) / window.innerWidth : 0.5;
  const y = rect.height ? (rect.top + rect.height / 2) / window.innerHeight : 0.5;
  return { x, y };
}

export function scrollOffsetToRatio(el: HTMLElement) {
  const maxX = el.scrollWidth - el.clientWidth;
  const maxY = el.scrollHeight - el.clientHeight;
  const x = maxX > 0 ? el.scrollLeft / maxX : 0;
  const y = maxY > 0 ? el.scrollTop / maxY : 0;
  return { x, y };
}

export function elementCenterToRatio(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const x = (rect.left + el.clientWidth / 2) / window.innerWidth;
  const y = (rect.top + el.clientHeight / 2) / window.innerHeight;
  return { x, y };
}

export function ratioToPoint(x: number, y: number) {
  return {
    x: x * window.innerWidth,
    y: y * window.innerHeight
  };
}

export function ratioToScrollOffset(target: HTMLElement, x: number, y: number) {
  const maxX = target.scrollWidth - target.clientWidth;
  const maxY = target.scrollHeight - target.clientHeight;
  const left = x * maxX;
  const top = y * maxY;
  return { left, top };
}