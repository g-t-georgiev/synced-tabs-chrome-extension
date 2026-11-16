import { hostRules, parseTargetMatches, type HostRule } from "./target-matches";

export const ACTIONS = {
  BROADCAST: "BROADCAST_EVENT",
  EXECUTE: "EXECUTE_SYNCED_EVENT",
  /** A toast raised in a child frame, relayed by the worker to the tab's top frame. */
  NOTIFY: "SHOW_NOTICE",
  /** A ghost-cursor point climbing from a child frame to its parent, via the worker. */
  CURSOR_RELAY: "RELAY_CURSOR",
} as const;

export const MESSAGE_TYPES = {
  POINTER_EVENT: "POINTER_EVENT",
  POINTER_MOVE: "POINTER_MOVE",
  KEY_EVENT: "KEY_EVENT",
  SCROLL_EVENT: "SCROLL_EVENT",
  PANEL_DRAG: "PANEL_DRAG",
  TEXT_INPUT: "TEXT_INPUT",
  TEXT_FOCUS: "TEXT_FOCUS",
  TEXT_SELECTION: "TEXT_SELECTION",
} as const;

export const DEFAULT_CONFIG = {
  syncMouse: false,
  syncScroll: false,
  syncKeyboard: true,
  syncCursor: true,
  syncText: true,
  /** Mirror only to tabs in the sender's own window (a split view is one window). */
  sameWindowOnly: false,
};

/**
 * Hostnames whose tabs take part in mirroring, on any port (local dev servers move between
 * 8080, 8081, ...). From `VITE_TARGET_MATCHES` in `.env`, applied at build time; local dev
 * servers only when unset. Compared against the parsed URL hostname, never as a substring.
 */
export const TARGET_HOSTS: readonly HostRule[] = hostRules(
  parseTargetMatches(import.meta.env.VITE_TARGET_MATCHES),
);
