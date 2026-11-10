import { ACTIONS, TARGET_HOSTS } from "../shared/constants";

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === ACTIONS.BROADCAST) {
    const senderTabId = sender.tab?.id;
    // Top-frame messages only concern top frames, so skip delivering them to iframes.
    // Iframe messages reach every frame; receivers match them by `framePath`.
    const options: chrome.tabs.MessageSendOptions = sender.frameId === 0 ? { frameId: 0 } : {};
    const execute = { ...message, action: ACTIONS.EXECUTE };

    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(async (tab) => {
        if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) return;

        // Skip originating tab
        if (tab.id === senderTabId) return;

        const isTargetDomain = TARGET_HOSTS.some((host) => tab.url && tab.url.includes(host));

        if (!isTargetDomain) return;

        console.log(`[BACKGROUND] Targeting Tab ${tab.id} (${tab.url})`);

        // Safely send message; if content script missing, force inject it
        try {
          await chrome.tabs.sendMessage(tab.id, execute, options);
        } catch {
          console.warn(
            `[BACKGROUND] Tab ${tab.id} missing content script. Injecting dynamically...`,
          );

          try {
            // Force inject script
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["content.js"],
            });

            // Resend message after injection
            await chrome.tabs.sendMessage(tab.id, execute, options);
          } catch (injectErr) {
            console.error(`[BACKGROUND] Could not inject into Tab ${tab.id}:`, injectErr);
          }
        }
      });
    });
  }
});
