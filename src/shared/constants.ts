export const ACTIONS = {
  BROADCAST: "BROADCAST_EVENT",
  EXECUTE: "EXECUTE_SYNCED_EVENT",
  /** A toast raised in a child frame, relayed by the worker to the tab's top frame. */
  NOTIFY: "SHOW_NOTICE",
} as const;

export const MESSAGE_TYPES = {
  POINTER_EVENT: "POINTER_EVENT",
  POINTER_MOVE: "POINTER_MOVE",
  KEY_EVENT: "KEY_EVENT",
  SCROLL_EVENT: "SCROLL_EVENT",
} as const;

export const DEFAULT_CONFIG = {
  syncMouse: false,
  syncScroll: false,
  syncKeyboard: true,
  syncCursor: true,
};

/**
 * Hostnames whose tabs take part in mirroring, on any port (local dev servers move between
 * 8080, 8081, …). Compared against the parsed URL hostname exactly, never as a substring.
 */
export const TARGET_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "frontend-dev.octoplay.dev",
]);
