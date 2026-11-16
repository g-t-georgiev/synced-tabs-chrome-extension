/**
 * Where a child frame's viewport starts inside this frame's viewport, in px: the content box
 * of the `<iframe>` (or `<frame>`) hosting `child`, i.e. its border box plus border and
 * padding. `null` if no element in this document (or its open shadow roots) hosts it.
 *
 * Works across origins: a cross-origin child's document is off limits, but the parent can
 * still compare `contentWindow` with the WindowProxy from `window.frames`.
 */
export function frameContentOffset(
  child: Window | null | undefined,
  /** Where to look; by default this document, including open shadow roots. */
  hosts?: Iterable<HTMLIFrameElement | HTMLFrameElement>,
): { x: number; y: number } | null {
  if (!child) return null;
  const host = hosts ? findHost(hosts, child) : hostOf(child);
  if (!host) return null;

  const rect = host.getBoundingClientRect();
  const style = getComputedStyle(host);
  return {
    x: rect.left + host.clientLeft + (parseFloat(style.paddingLeft) || 0),
    y: rect.top + host.clientTop + (parseFloat(style.paddingTop) || 0),
  };
}

type FrameHost = HTMLIFrameElement | HTMLFrameElement;
const FRAME_SELECTOR = "iframe, frame";

/** Hosts found so far, per child window: cursor points arrive every frame. */
const knownHosts: WeakMap<Window, FrameHost> = new WeakMap();

function findHost(hosts: Iterable<FrameHost>, child: Window): FrameHost | null {
  for (const host of hosts) if (host.contentWindow === child) return host;
  return null;
}

/** Frame hosts inside open shadow roots, at any depth (a web component's iframe). */
function* shadowHosts(root: Document | ShadowRoot): Generator<FrameHost> {
  for (const el of root.querySelectorAll("*")) {
    if (!el.shadowRoot) continue;
    yield* el.shadowRoot.querySelectorAll<FrameHost>(FRAME_SELECTOR);
    yield* shadowHosts(el.shadowRoot);
  }
}

/** The element in this document hosting `child`: light DOM first, then shadow roots. */
function hostOf(child: Window): FrameHost | null {
  const known = knownHosts.get(child);
  if (known?.isConnected && known.contentWindow === child) return known;

  const host =
    findHost(document.querySelectorAll<FrameHost>(FRAME_SELECTOR), child) ??
    findHost(shadowHosts(document), child);
  if (host) knownHosts.set(child, host);
  return host;
}
