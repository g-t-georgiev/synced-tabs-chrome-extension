const TAG_STYLE = "font-weight: bold;";
const RESET = "color: default;";

/**
 * @param {string} windowId
 * @returns
 */
export function createLogger(windowId) {
  const shortId = windowId.slice(0, 8);

  return {
    /** @param {string} url */
    initialized(url) {
      const color = "#00ff00"
      console.log(`%c[SYNC INITIALIZED]%c Window ID [${shortId}] URL: ${url}`, `color: ${color}; ${TAG_STYLE}`, RESET);
    },
    /**
     * @template {any} T
     * @param {T & { type: string; subType: string; }} message
     */
    remote(message) {
      const color = "#00ffff";
      console.log(`%c[REMOTE EVENT RECEIVED]%c ${message.type} -> ${message.subType || ""}`, `color: ${color}; ${TAG_STYLE}`, RESET, message);
    },
    /**
     * @template {...any} T
     * @param {string} label 
     * @param  {T} details 
     */
    execute(label, ...details) {
      console.log(`[SYNC EXECUTE] ${label}`, ...details);
    }
  };
}