import type { DeliveryReport, NoticeLevel, Viewport } from "../shared/types";

export interface DropNotice {
  level: NoticeLevel;
  key: string;
  text: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const size = ({ w, h }: Viewport) => `${w}×${h}`;

/**
 * Turns the worker's report for one broadcast into the toasts the sender should see:
 * one for tabs that dropped it because their window size differs, one for panels that
 * didn't follow a drag, one for tabs it could not reach at all. `what` names what was
 * mirrored ("Clicks").
 */
export function describeDrops(report: DeliveryReport, what: string, here: Viewport): DropNotice[] {
  const notices: DropNotice[] = [];

  const sizes = new Set<string>();
  let mismatched = 0;
  for (const { result } of report.results) {
    if (result?.status !== "dropped" || result.reason !== "viewport-mismatch") continue;
    mismatched += 1;
    sizes.add(size(result.viewport));
  }

  if (mismatched) {
    notices.push({
      level: "warning",
      key: `viewport-mismatch:${what}`,
      text:
        `${what} were not mirrored to ${plural(mismatched, "tab")}: window size differs ` +
        `(this tab ${size(here)}, other ${[...sizes].join(", ")}).`,
    });
  }

  const panelMisses = report.results.filter(
    ({ result }) => result?.status === "dropped" && result.reason === "panel-miss",
  ).length;
  if (panelMisses) {
    notices.push({
      level: "warning",
      key: `panel-miss:${what}`,
      text:
        `The panel in ${plural(panelMisses, "tab")} is in a different place, ` +
        `so it didn't follow.`,
    });
  }

  const fieldMismatches = report.results.filter(
    ({ result }) => result?.status === "dropped" && result.reason === "field-mismatch",
  ).length;
  if (fieldMismatches) {
    notices.push({
      level: "warning",
      key: `field-mismatch:${what}`,
      text:
        `${what} were not mirrored to ${plural(fieldMismatches, "tab")}: ` +
        `no identical field in the same place.`,
    });
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
