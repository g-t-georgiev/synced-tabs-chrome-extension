import { ACTIONS } from "../shared/constants";
import { createRouter, type BroadcastMessage } from "./router";

const router = createRouter();

chrome.runtime.onMessage.addListener((message: BroadcastMessage, sender) => {
  if (message?.action !== ACTIONS.BROADCAST) return;
  void router.fanOut(message, sender);
});
