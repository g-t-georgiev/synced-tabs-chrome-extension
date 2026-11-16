import type { DeliveryReport, NoticeLevel, TabDelivery, Viewport } from "../shared/types";

export interface DropNotice {
  level: NoticeLevel;
  key: string;
  text: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const size = ({ w, h }: Viewport) => `${w}x${h}`;

type Dropped = Extract<NonNullable<TabDelivery["result"]>, { status: "dropped" }>;

/** One toast per kind of drop: which results it counts, and what it says for `count` tabs. */
const DROP_NOTICES: Array<{
  reason: Dropped["reason"];
  text: (what: string, tabs: string, drops: Dropped[], here: Viewport) => string;
}> = [
  {
    reason: "viewport-mismatch",
    text: (what, tabs, drops, here) => {
      const sizes = new Set(
        drops.map((d) => (d.reason === "viewport-mismatch" ? size(d.viewport) : "")),
      );
      // Say the element differs only when every drop actually compared one.
      const checked = drops.every((d) => d.reason === "viewport-mismatch" && d.elementChecked);
      return (
        `${what} were not mirrored to ${tabs}: window size differs` +
        `${checked ? " and the element there doesn't match" : ""} ` +
        `(this tab ${size(here)}, other ${[...sizes].join(", ")}).`
      );
    },
  },
  {
    reason: "panel-miss",
    text: (_what, tabs) => `The panel in ${tabs} is in a different place, so it didn't follow.`,
  },
  {
    reason: "field-mismatch",
    text: (what, tabs) =>
      `${what} were not mirrored to ${tabs}: no identical field in the same place.`,
  },
  {
    reason: "element-mismatch",
    text: (what, tabs) => `${what} were not mirrored to ${tabs}: the element there doesn't match.`,
  },
];

/**
 * Turns the worker's report for one broadcast into the toasts the sender should see: a
 * warning per kind of drop (window size, panel elsewhere, field or element differs), and an
 * error for tabs it could not reach at all. `what` names what was mirrored ("Clicks").
 */
export function describeDrops(report: DeliveryReport, what: string, here: Viewport): DropNotice[] {
  const notices: DropNotice[] = [];

  for (const { reason, text } of DROP_NOTICES) {
    const drops = report.results
      .map(({ result }) => result)
      .filter(
        (result): result is Dropped => result?.status === "dropped" && result.reason === reason,
      );
    if (drops.length) {
      notices.push({
        level: "warning",
        key: `${reason}:${what}`,
        text: text(what, plural(drops.length, "tab"), drops, here),
      });
    }
  }

  const unreachable = report.results.filter(({ status }) => status === "unreachable").length;
  if (unreachable) {
    notices.push({
      level: "error",
      key: `unreachable:${what}`,
      text:
        `${what} could not reach ${plural(unreachable, "tab")}. ` +
        `Reload ${unreachable === 1 ? "it" : "them"} to mirror again.`,
    });
  }

  return notices;
}
