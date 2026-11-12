import { elementAt } from "./element-resolver";
import { fingerprint, sameField, type FieldFingerprint } from "./field-fingerprint";

/**
 * Where a point is, described by the element under it rather than by the window: lets a
 * receiver whose window has a different size (another monitor's display scaling, zoom)
 * still find the same spot when the page scales its layout with the window.
 */
export interface ElementAnchor {
  /** Identities of the target and up to {@link ANCESTORS} ancestors, innermost first. */
  chain: FieldFingerprint[];
  /** The point inside the target's box, as fractions of its width and height. */
  rx: number;
  ry: number;
}

/** Ancestors included in an anchor, so a bare `<div>` or `<canvas>` can't match any other. */
const ANCESTORS = 2;
/** By default, how far above the element hit on the receiver to look for the anchored one. */
const SEARCH_DEPTH = 3;

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Identities of `el` and up to {@link ANCESTORS} ancestors, stopping below `<body>`. */
function identityChain(el: Element): FieldFingerprint[] {
  const chain: FieldFingerprint[] = [];
  for (
    let current: Element | null = el;
    current && chain.length <= ANCESTORS && current !== document.body;
    current = parentOf(current)
  ) {
    chain.push(fingerprint(current));
  }
  return chain;
}

/** Whether `el` is `ancestor` or inside it, also across shadow roots. */
export function isWithin(el: Element, ancestor: Element): boolean {
  for (let current: Element | null = el; current; current = parentOf(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

function sameChain(a: FieldFingerprint[], b: FieldFingerprint[]) {
  return a.length === b.length && a.every((identity, i) => sameField(identity, b[i]!));
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/** Describes the point (`x`, `y`, viewport px) relative to `target`. */
export function anchorAt(target: Element, x: number, y: number): ElementAnchor {
  const rect = target.getBoundingClientRect();
  return {
    chain: identityChain(target),
    rx: rect.width ? clamp01((x - rect.left) / rect.width) : 0.5,
    ry: rect.height ? clamp01((y - rect.top) / rect.height) : 0.5,
  };
}

/**
 * Finds the anchored element near `approx` (the sender's point mapped by window ratio) and
 * returns the point at the same fractions inside it, or `null` when no element there (or
 * up to `searchDepth` levels above it) has the same identity chain.
 */
export function resolveAnchor(
  anchor: ElementAnchor,
  approx: { x: number; y: number },
  searchDepth = SEARCH_DEPTH,
): { element: Element; x: number; y: number } | null {
  let candidate = elementAt(approx.x, approx.y);

  for (let depth = 0; candidate && depth <= searchDepth; depth++) {
    if (sameChain(identityChain(candidate), anchor.chain)) {
      const rect = candidate.getBoundingClientRect();
      return {
        element: candidate,
        x: rect.left + anchor.rx * rect.width,
        y: rect.top + anchor.ry * rect.height,
      };
    }
    candidate = parentOf(candidate);
  }

  return null;
}
