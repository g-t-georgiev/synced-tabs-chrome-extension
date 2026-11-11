import { ACTIONS } from "../shared/constants";
import type { NoticeMessage } from "../shared/types";
import { relayNotice } from "./notices";
import { createRouter, type BroadcastMessage } from "./router";

const router = createRouter();

chrome.runtime.onMessage.addListener((message: BroadcastMessage | NoticeMessage, sender) => {
  if (message?.action === ACTIONS.BROADCAST) {
    void router.fanOut(message as BroadcastMessage, sender);
  } else if (message?.action === ACTIONS.NOTIFY) {
    void relayNotice(message as NoticeMessage, sender);
  }
});
