(async () => {
  // Prevent duplicate script execution in the same context
  if (window.__MIRROR_SYNC_INITIALIZED__) {
    return;
  }
  window.__MIRROR_SYNC_INITIALIZED__ = true;

  const source = chrome.runtime.getURL("content-main.js");
  const script = await import(source);
  script.main();
})();