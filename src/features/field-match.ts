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

/**
 * The field in this frame identical to the sender's, or why there is none. Identical means:
 * same window size, a value field on top at the sender field's centre, the same box within
 * 1px, and the same tag, type, id, name, placeholder, aria-label and classes.
 */
export function findIdenticalField(locator: FieldLocator): ValueField | ApplyResult {
  if (!viewportMatches(locator.viewport)) return viewportMismatch();

  const { rect } = locator;
  const field = elementAt(rect.left + rect.width / 2, rect.top + rect.height / 2);

  if (
    !isValueField(field) ||
    !sameRect(fieldRect(field), rect) ||
    !sameField(fingerprint(field), locator.fingerprint)
  ) {
    return FIELD_MISMATCH;
  }

  return field;
}

/** Narrows {@link findIdenticalField}'s answer to "found". */
export function isFound(match: ValueField | ApplyResult): match is ValueField {
  return match instanceof Element;
}
