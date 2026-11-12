import type { Viewport } from "../shared/types";
import { elementAt } from "./element-resolver";
import { fingerprint, sameField, type FieldFingerprint, type FieldRect } from "./field-fingerprint";

/** One level of an anchor's identity chain. */
export interface AnchorIdentity extends FieldFingerprint {
  /**
   * Index among siblings with the same tag (`nth-of-type`, from 0), so identical rows built
   * from the same markup (Tweakpane buttons, list items) don't match each other.
   */
  index: number;
}

/**
 * Where a point is, described by the element under it rather than by the window. A receiver
 * accepts the point only if the same element is there, in the same box, and then uses the
 * same spot inside it. Also lets a receiver whose window has another size (display scaling,
 * zoom) follow a page that scales its layout with the window.
 */
export interface ElementAnchor {
  /** Identities of the target and up to {@link ANCESTORS} ancestors, innermost first. */
  chain: AnchorIdentity[];
  /** The target's box in the sender's viewport, px. Absent in anchors from older builds. */
  rect?: FieldRect;
  /** The point inside the target's box, as fractions of its width and height. */
  rx: number;
  ry: number;
}

/** Ancestors included in an anchor, so a bare `<div>` or `<canvas>` can't match any other. */
const ANCESTORS = 2;
/** By default, how far above the element hit on the receiver to look for the anchored one. */
const SEARCH_DEPTH = 3;
/** Box tolerance: absorbs rounding and hover/press effects (`scale(1.05)`), not a neighbour. */
const BOX_TOLERANCE_PX = 4;
const BOX_TOLERANCE_RATIO = 0.1;

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Index of `el` among its siblings (light DOM or shadow root) with the same tag. */
function indexOfType(el: Element): number {
  const siblings =
    el.parentNode instanceof Element || el.parentNode instanceof ShadowRoot
      ? el.parentNode.children
      : null;
  if (!siblings) return 0;

  let index = 0;
  for (const sibling of siblings) {
    if (sibling === el) return index;
    if (sibling.tagName === el.tagName) index += 1;
  }
  return index;
}

/** Identities of `el` and up to {@link ANCESTORS} ancestors, stopping below `<body>`. */
function identityChain(el: Element): AnchorIdentity[] {
  const chain: AnchorIdentity[] = [];
  for (
    let current: Element | null = el;
    current && chain.length <= ANCESTORS && current !== document.body;
    current = parentOf(current)
  ) {
    chain.push({ ...fingerprint(current), index: indexOfType(current) });
  }
  return chain;
}

function sameChain(a: AnchorIdentity[], b: AnchorIdentity[]) {
  return (
    a.length === b.length &&
    a.every(
      (identity, i) =>
        sameField(identity, b[i]!) &&
        // Anchors from older builds have no index: compare only when both do.
        (typeof identity.index !== "number" ||
          typeof b[i]!.index !== "number" ||
          identity.index === b[i]!.index),
    )
  );
}

/** Whether `actual` is the sender's box, scaled to this viewport, within the tolerance. */
function sameBox(actual: DOMRect, sender: FieldRect, from: Viewport | undefined) {
  const sx = from ? window.innerWidth / from.w : 1;
  const sy = from ? window.innerHeight / from.h : 1;
  const expected = {
    left: sender.left * sx,
    top: sender.top * sy,
    width: sender.width * sx,
    height: sender.height * sy,
  };
  const tolX = Math.max(BOX_TOLERANCE_PX, expected.width * BOX_TOLERANCE_RATIO);
  const tolY = Math.max(BOX_TOLERANCE_PX, expected.height * BOX_TOLERANCE_RATIO);
  return (
    Math.abs(actual.left - expected.left) <= tolX &&
    Math.abs(actual.width - expected.width) <= tolX &&
    Math.abs(actual.top - expected.top) <= tolY &&
    Math.abs(actual.height - expected.height) <= tolY
  );
}

/** Whether `el` is `ancestor` or inside it, also across shadow roots. */
export function isWithin(el: Element, ancestor: Element): boolean {
  for (let current: Element | null = el; current; current = parentOf(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/** Describes the point (`x`, `y`, viewport px) relative to `target`. */
export function anchorAt(target: Element, x: number, y: number): ElementAnchor {
  const { left, top, width, height } = target.getBoundingClientRect();
  return {
    chain: identityChain(target),
    rect: { left, top, width, height },
    rx: width ? clamp01((x - left) / width) : 0.5,
    ry: height ? clamp01((y - top) / height) : 0.5,
  };
}

/**
 * Finds the anchored element near `approx` (the sender's point mapped by window ratio) and
 * returns the point at the same fractions inside it, or `null` when no element there (or
 * up to `searchDepth` levels above it) has the same identity chain and box. `sender` is the
 * sender's viewport, to scale its box when the window sizes differ.
 */
export function resolveAnchor(
  anchor: ElementAnchor,
  approx: { x: number; y: number },
  { sender, searchDepth = SEARCH_DEPTH }: { sender?: Viewport; searchDepth?: number } = {},
): { element: Element; x: number; y: number } | null {
  let candidate = elementAt(approx.x, approx.y);

  for (let depth = 0; candidate && depth <= searchDepth; depth++) {
    if (sameChain(identityChain(candidate), anchor.chain)) {
      const rect = candidate.getBoundingClientRect();
      // Same identity but elsewhere or another size: a different control, or fixed-pixel UI
      // on a screen that scales differently. No other element up the chain can match.
      if (anchor.rect && !sameBox(rect, anchor.rect, sender)) return null;
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
