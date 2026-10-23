import { ACTIONS, TARGET_HOSTS } from "../shared/constants";

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === ACTIONS.BROADCAST) {
    const senderTabId = sender.tab?.id;

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
          await chrome.tabs.sendMessage(tab.id, {
            ...message,
            action: ACTIONS.EXECUTE,
          });
        } catch (err) {
          console.warn(`[BACKGROUND] Tab ${tab.id} missing content script. Injecting dynamically...`);

          try {
            // Force inject script
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["content-bootstrap.js"]
            });

            // Resend message after injection
            await chrome.tabs.sendMessage(tab.id, {
              ...message,
              action: ACTIONS.EXECUTE,
            });
          } catch (injectErr) {
            console.error(`[BACKGROUND] Could not inject into Tab ${tab.id}:`, injectErr);
          }
        }
      });
    });
  }
});