import { ACTIONS } from "../shared/constants";
import type { CursorRelayMessage, DeliveryReport, NoticeMessage } from "../shared/types";
import { relayCursor, relayNotice } from "./relays";
import { createRouter, type BroadcastMessage } from "./router";

const router = createRouter();

chrome.runtime.onMessage.addListener(
  (message: BroadcastMessage | NoticeMessage | CursorRelayMessage, sender, sendResponse) => {
    if (message?.action === ACTIONS.BROADCAST) {
      const broadcast = message as BroadcastMessage;
      const delivery = router.fanOut(broadcast, sender);
      if (!broadcast.report) return;

      // Keep the channel open and answer once every tab has answered.
      delivery.then(
        (results) => sendResponse({ results } satisfies DeliveryReport),
        () => sendResponse({ results: [] } satisfies DeliveryReport),
      );
      return true;
    }

    if (message?.action === ACTIONS.NOTIFY) {
      void relayNotice(message as NoticeMessage, sender);
    } else if (message?.action === ACTIONS.CURSOR_RELAY) {
      void relayCursor(message as CursorRelayMessage, sender);
    }
  },
);
