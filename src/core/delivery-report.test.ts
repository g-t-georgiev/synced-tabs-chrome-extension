import { describe, expect, it } from "vite-plus/test";
import type { TabDelivery } from "../shared/types";
import { describeDrops } from "./delivery-report";

const here = { w: 1280, h: 720 };
const applied: TabDelivery = { tabId: 1, status: "delivered", result: { status: "applied" } };
const mismatch = (tabId: number, w: number, h: number): TabDelivery => ({
  tabId,
  status: "delivered",
  result: { status: "dropped", reason: "viewport-mismatch", viewport: { w, h } },
});

describe("describeDrops", () => {
  it("is silent when every tab applied the message", () => {
    expect(
      describeDrops({ results: [applied, { tabId: 2, status: "delivered" }] }, "Clicks", here),
    ).toEqual([]);
  });

  it("warns about tabs whose window size differs, naming both sizes", () => {
    expect(describeDrops({ results: [applied, mismatch(2, 1280, 577)] }, "Clicks", here)).toEqual([
      {
        level: "warning",
        key: "viewport-mismatch:Clicks",
        text: "Clicks were not mirrored to 1 tab: window size differs (this tab 1280×720, other 1280×577).",
      },
    ]);
  });

  it("counts several mismatched tabs and lists each distinct size once", () => {
    const [notice] = describeDrops(
      { results: [mismatch(2, 1280, 577), mismatch(3, 1280, 577), mismatch(4, 1100, 720)] },
      "Clicks",
      here,
    );

    expect(notice!.text).toBe(
      "Clicks were not mirrored to 3 tabs: window size differs (this tab 1280×720, other 1280×577, 1100×720).",
    );
  });

  it("warns when panels elsewhere didn't follow a drag", () => {
    const miss: TabDelivery = {
      tabId: 2,
      status: "delivered",
      result: { status: "dropped", reason: "panel-miss" },
    };

    expect(describeDrops({ results: [applied, miss] }, "Panel moves", here)).toEqual([
      {
        level: "warning",
        key: "panel-miss:Panel moves",
        text: "The panel in 1 tab is in a different place, so it didn't follow.",
      },
    ]);
  });

  it("reports unreachable tabs as an error", () => {
    expect(
      describeDrops(
        {
          results: [
            { tabId: 2, status: "unreachable" },
            { tabId: 3, status: "unreachable" },
          ],
        },
        "Clicks",
        here,
      ),
    ).toEqual([
      {
        level: "error",
        key: "unreachable:Clicks",
        text: "Clicks could not reach 2 tabs. Reload them to mirror again.",
      },
    ]);
  });

  it("keys notices by what was mirrored, so clicks and scrolls get separate toasts", () => {
    const report = { results: [mismatch(2, 1280, 577)] };

    expect(describeDrops(report, "Clicks", here)[0]!.key).not.toBe(
      describeDrops(report, "Scrolls inside panels", here)[0]!.key,
    );
  });
});
