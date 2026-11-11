/**
 * Where a child frame's viewport starts inside this frame's viewport, in px: the content box
 * of the `<iframe>` (or `<frame>`) hosting `child`, i.e. its border box plus border and
 * padding. `null` if no element in this document hosts it.
 *
 * Works across origins: a cross-origin child's document is off limits, but the parent can
 * still compare `contentWindow` with the WindowProxy from `window.frames`.
 */
export function frameContentOffset(
  child: Window | null | undefined,
  hosts: Iterable<HTMLIFrameElement | HTMLFrameElement> = document.querySelectorAll<
    HTMLIFrameElement | HTMLFrameElement
  >("iframe, frame"),
): { x: number; y: number } | null {
  if (!child) return null;

  for (const host of hosts) {
    if (host.contentWindow !== child) continue;

    const rect = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    return {
      x: rect.left + host.clientLeft + (parseFloat(style.paddingLeft) || 0),
      y: rect.top + host.clientTop + (parseFloat(style.paddingTop) || 0),
    };
  }

  return null;
}
