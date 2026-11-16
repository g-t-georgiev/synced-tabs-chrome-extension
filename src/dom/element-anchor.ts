import type { Viewport } from "../shared/types";
import { elementAt, isOwnUi } from "./element-resolver";
import { fingerprint, sameField, type FieldFingerprint, type FieldRect } from "./field-fingerprint";

/** One level of an anchor's identity chain. */
export interface AnchorIdentity extends FieldFingerprint {
  /**
   * Index among look-alike siblings (same tag and classes, from 0), so identical rows built
   * from the same markup (Tweakpane buttons, list items) don't match each other. Siblings that
   * look different, and the extension's own elements, don't count: they can differ between
   * tabs without the element being a different one.
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

/** Tag and classes: what makes two siblings look alike. */
const lookAlike = (el: Element) => `${el.tagName} ${[...el.classList].sort().join(" ")}`;

/**
 * Index of `el` among its look-alike siblings (light DOM or shadow root). The extension's own
 * elements are skipped: the panel, cursor, toasts and focus ring are added to the page, and
 * which of them exist differs per tab (the ring only appears where one was shown).
 */
function indexOfType(el: Element): number {
  const siblings =
    el.parentNode instanceof Element || el.parentNode instanceof ShadowRoot
      ? el.parentNode.children
      : null;
  if (!siblings) return 0;

  const key = lookAlike(el);
  let index = 0;
  for (const sibling of siblings) {
    if (sibling === el) return index;
    if (!isOwnUi(sibling) && lookAlike(sibling) === key) index += 1;
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

/** A box's size and centre, for logs: `171x169 centred at (2449, 1149)`. */
function centredText(width: number, height: number, cx: number, cy: number) {
  return `${Math.round(width)}x${Math.round(height)} centred at (${Math.round(cx)}, ${Math.round(cy)})`;
}

/**
 * Whether `actual` is the sender's box as this window would show it, and (for logs) what was
 * expected. Pages scale in different ways when the window's aspect ratio differs, so:
 *
 * - **size:** either stretched (each axis by its window ratio) or scaled uniformly by any
 *   factor between the two ratios (±10%), keeping the aspect ratio;
 * - **position:** the box centre at the same fraction of the window. A box that grows
 *   uniformly from a corner-pinned spot moves its corner, not its centre.
 *
 * Tolerance: max(4px, 10% of the size), per axis.
 */
function checkBox(
  actual: FieldRect,
  sender: FieldRect,
  from: Viewport | undefined,
): { ok: boolean; expected: string } {
  const sx = from ? window.innerWidth / from.w : 1;
  const sy = from ? window.innerHeight / from.h : 1;
  const tolX = Math.max(BOX_TOLERANCE_PX, actual.width * BOX_TOLERANCE_RATIO);
  const tolY = Math.max(BOX_TOLERANCE_PX, actual.height * BOX_TOLERANCE_RATIO);

  const cx = (sender.left + sender.width / 2) * sx;
  const cy = (sender.top + sender.height / 2) * sy;
  const centred =
    Math.abs(actual.left + actual.width / 2 - cx) <= tolX &&
    Math.abs(actual.top + actual.height / 2 - cy) <= tolY;

  const stretched =
    Math.abs(actual.width - sender.width * sx) <= tolX &&
    Math.abs(actual.height - sender.height * sy) <= tolY;

  const low = Math.min(sx, sy) * (1 - BOX_TOLERANCE_RATIO);
  const high = Math.max(sx, sy) * (1 + BOX_TOLERANCE_RATIO);
  const k = sender.width
    ? actual.width / sender.width
    : sender.height
      ? actual.height / sender.height
      : 1;
  const uniform =
    k >= low &&
    k <= high &&
    Math.abs(actual.width - sender.width * k) <= tolX &&
    Math.abs(actual.height - sender.height * k) <= tolY;

  const scale =
    Math.abs(sx - sy) < 0.005
      ? `x${sx.toFixed(2)}`
      : `x${sx.toFixed(2)} wide, x${sy.toFixed(2)} tall, or uniform x${low.toFixed(2)}-${high.toFixed(2)}`;
  return {
    ok: centred && (stretched || uniform),
    expected:
      `${centredText(sender.width * sx, sender.height * sy, cx, cy)} ` +
      `(sender ${Math.round(sender.width)}x${Math.round(sender.height)} ${scale})`,
  };
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

const round = (value: number) => Math.round(value);

/** A short CSS-like name for an element or identity: `div#id.class:nth-of-type(2)`. */
function identityText(identity: FieldFingerprint & { index?: number }) {
  const id = identity.id ? `#${identity.id}` : "";
  const classes = identity.classes.map((cls) => `.${cls}`).join("");
  const nth = typeof identity.index === "number" ? `:nth-of-type(${identity.index + 1})` : "";
  return `${identity.tag.toLowerCase()}${id}${classes}${nth}`;
}

/** A short CSS-like name for an element, for logs. */
export function describeElement(el: Element): string {
  return identityText({ ...fingerprint(el), index: indexOfType(el) });
}

const IDENTITY_FIELDS = ["tag", "type", "id", "name", "placeholder", "ariaLabel"] as const;

/** The first difference between two identity chains, innermost first, for logs. */
function chainDifference(found: AnchorIdentity[], expected: AnchorIdentity[]): string {
  for (let level = 0; level < Math.min(found.length, expected.length); level++) {
    const a = found[level]!;
    const b = expected[level]!;
    for (const field of IDENTITY_FIELDS) {
      if (a[field] !== b[field]) return `at level ${level}, ${field}: ${a[field]} vs ${b[field]}`;
    }
    if (a.classes.join(" ") !== b.classes.join(" ")) {
      return `at level ${level}, classes: [${a.classes.join(" ")}] vs [${b.classes.join(" ")}]`;
    }
    if (typeof b.index === "number" && a.index !== b.index) {
      return `at level ${level}, position among siblings: ${a.index + 1} vs ${b.index + 1}`;
    }
  }
  return `chain length: ${found.length} vs ${expected.length}`;
}

export type AnchorMatch =
  | { found: true; element: Element; x: number; y: number }
  /** `reason` says why, for logs: nothing there, identity differs, or box differs. */
  | { found: false; reason: string };

/**
 * Like {@link resolveAnchor}, but explains a miss: the first identity difference of the
 * element hit, or the expected and found boxes when the identity matched.
 */
export function matchAnchor(
  anchor: ElementAnchor,
  approx: { x: number; y: number },
  { sender, searchDepth = SEARCH_DEPTH }: { sender?: Viewport; searchDepth?: number } = {},
): AnchorMatch {
  const hit = elementAt(approx.x, approx.y);
  if (!hit) return { found: false, reason: `nothing at (${round(approx.x)}, ${round(approx.y)})` };

  let candidate: Element | null = hit;
  for (let depth = 0; candidate && depth <= searchDepth; depth++) {
    if (sameChain(identityChain(candidate), anchor.chain)) {
      const rect = candidate.getBoundingClientRect();
      // Same identity but elsewhere or another size: a different control, or fixed-pixel UI
      // on a screen that scales differently. No other element up the chain can match.
      if (anchor.rect) {
        const box = checkBox(rect, anchor.rect, sender);
        if (!box.ok) {
          const found = centredText(
            rect.width,
            rect.height,
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return {
            found: false,
            reason:
              `box differs: expected ${box.expected}, found ${found} ` +
              `on ${describeElement(candidate)}`,
          };
        }
      }
      return {
        found: true,
        element: candidate,
        x: rect.left + anchor.rx * rect.width,
        y: rect.top + anchor.ry * rect.height,
      };
    }
    candidate = parentOf(candidate);
  }

  const expected = anchor.chain[0] ? identityText(anchor.chain[0]) : "(empty chain)";
  return {
    found: false,
    reason:
      `identity differs ${chainDifference(identityChain(hit), anchor.chain)} ` +
      `(hit ${describeElement(hit)}, expected ${expected})`,
  };
}

/**
 * Finds the anchored element near ` (the sender's point mapped by window ratio) and
 * returns the point at the same fractions inside it, or `null` when no element there (or
 * up to `searchDepth` levels above it) has the same identity chain and box. `sender` is the
 * sender's viewport, to scale its box when the window sizes differ.
 */
export function resolveAnchor(
  anchor: ElementAnchor,
  approx: { x: number; y: number },
  { sender, searchDepth = SEARCH_DEPTH }: { sender?: Viewport; searchDepth?: number } = {},
): { element: Element; x: number; y: number } | null {
  const match = matchAnchor(anchor, approx, { sender, searchDepth });
  return match.found ? { element: match.element, x: match.x, y: match.y } : null;
}
