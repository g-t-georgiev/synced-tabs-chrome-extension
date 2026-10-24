import type { Logger } from "../shared/types";

const TAG_STYLE = "font-weight: bold;";
const RESET = "color: default;";

export function createLogger(windowId: string): Logger {
  const shortId = windowId.slice(0, 8);

  return {
    initialized(url) {
      const color = "#00ff00"
      console.log(`%c[SYNC INITIALIZED]%c Window ID [${shortId}] URL: ${url}`, `color: ${color}; ${TAG_STYLE}`, RESET);
    },
    remote(message) {
      const color = "#00ffff";
      console.log(`%c[REMOTE EVENT RECEIVED]%c ${message.type} -> ${message.subType || ""}`, `color: ${color}; ${TAG_STYLE}`, RESET, message);
    },
    execute(label, ...details) {
      console.log(`[SYNC EXECUTE] ${label}`, ...details);
    }
  };
}