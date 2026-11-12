import type { ApplyResult, Viewport } from "../shared/types";
import {
  elementAt,
  fieldRect,
  fingerprint,
  isValueField,
  sameField,
  sameRect,
  viewportMatches,
  viewportMismatch,
  type FieldFingerprint,
  type FieldRect,
  type ValueField,
} from "../dom";

/** How a sender describes a text field so a receiver can find the same one. */
export interface FieldLocator {
  viewport?: Viewport;
  /** The field's box in the sender's viewport, px. */
  rect: FieldRect;
  fingerprint: FieldFingerprint;
}

const FIELD_MISMATCH: ApplyResult = { status: "dropped", reason: "field-mismatch" };

/** Box tolerance when windows differ in size: rounding on both sides, after scaling. */
const SCALED_TOLERANCE_PX = 2;

/** The sender's box mapped into this viewport by the window-size ratio. */
function scaledRect(rect: FieldRect, sender: Viewport): FieldRect {
  const sx = window.innerWidth / sender.w;
  const sy = window.innerHeight / sender.h;
  return {
    left: rect.left * sx,
    top: rect.top * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

/**
 * The field in this frame identical to the sender's, or why there is none. Identical means:
 * a value field on top at the sender field's centre, the same box within 1px, and the same
 * tag, type, id, name, placeholder, aria-label and classes.
 *
 * When the windows differ in size, the sender's box is scaled by the window ratio first
 * (pages that scale their layout with the window keep fields in proportion), within 2px.
 * Fixed-pixel UI doesn't scale, so its fields fail the box check and are reported as a
 * size mismatch.
 */
export function findIdenticalField(locator: FieldLocator): ValueField | ApplyResult {
  const sameSize = viewportMatches(locator.viewport);
  const rect = sameSize ? locator.rect : scaledRect(locator.rect, locator.viewport!);
  const tolerance = sameSize ? 1 : SCALED_TOLERANCE_PX;
  const field = elementAt(rect.left + rect.width / 2, rect.top + rect.height / 2);

  if (
    !isValueField(field) ||
    !sameRect(fieldRect(field), rect, tolerance) ||
    !sameField(fingerprint(field), locator.fingerprint)
  ) {
    return sameSize ? FIELD_MISMATCH : viewportMismatch();
  }

  return field;
}

/** Narrows {@link findIdenticalField}'s answer to "found". */
export function isFound(match: ValueField | ApplyResult): match is ValueField {
  return match instanceof Element;
}
