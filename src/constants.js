export const ACTIONS = {
  BROADCAST: "BROADCAST_EVENT",
  EXECUTE: "EXECUTE_SYNCED_EVENT",
};

export const MESSAGE_TYPES = {
  POINTER_EVENT: "POINTER_EVENT",
  POINTER_MOVE: "POINTER_MOVE",
  KEY_EVENT: "KEY_EVENT",
  SCROLL_EVENT: "SCROLL_EVENT",
};

/** @typedef {typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES]} MessageType */

export const DEFAULT_CONFIG = {
  syncMouse: false,
  syncScroll: false,
  syncKeyboard: true,
  syncCursor: true,
};

/** @typedef {typeof DEFAULT_CONFIG} StateConfig */
/** @typedef {keyof StateConfig} StateConfigKey */
/** 
 * @typedef {{
 *  type: string;
 *  subType: string;
 *  isDocument: boolean;
 *  keyData: import("./dom/synthetic-events.js").KeyboardEventData;
 *  xRatio: number;
 *  yRatio: number;
 *  xPoint: number;
 *  yPoint: number;
 * }} MessagePayload
 */

export const TARGET_HOSTS = ["localhost", "frontend-dev.octoplay.dev"];