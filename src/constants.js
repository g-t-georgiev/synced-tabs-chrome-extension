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

export const DEFAULT_CONFIG = {
  syncMouse: false,
  syncScroll: false,
  syncKeyboard: true,
  syncCursor: true,
};

/** @typedef {typeof DEFAULT_CONFIG} StateConfig */
/** @typedef {keyof StateConfig} StateConfigKey */

/**
 * @template {unknown} State
 * @typedef {object} StateStore
 * @property {State} state
 * @property {Promise<State>} ready
 * @property {(<T extends keyof State>(key: T, value: State[T]) => Promise<void>)} set
 * @property {((listener: ((state: State) => unknown)) => (() => boolean))} subscribe
 */

/** @typedef {typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES]} MessageType */
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
/**
 * @template {object} [T = MessagePayload]
 * @typedef {T & { action: string; originWindowId: string; }} Message
 */
/**
 * @typedef {object} MessageController
 * @property {(<T extends unknown>(payload: T) => void)} broadcast
 * @property {(<T extends unknown>(handler: ((message: Message<T>) => void)) => (() => void))} onRemote
 */

/**
 * @template {StateConfigKey} [TKey = StateConfigKey]
 * @template {Partial<MessagePayload>} [TPayload = MessagePayload]
 * @typedef {object} Feature
 * @property {TKey} configKey
 * @property {(MessageType)[]} handles
 * @property {boolean} silent
 * @property {(() => (() => void))} capture
 * @property {((message: Message<TPayload>) => any)} apply
 */

/**
 * @typedef {object} SyncEngine
 * @property {((feature: Feature) => void)} register
 * @property {(() => void)} start
 * @property {(() => void)} stop
 */

/**
 * @typedef {object} UIController
 * @property {(() => void)} flash
 * @property {(() => void)} pulse
 */

/**
 * @typedef {object} CursorController
 * @property {((x: number, y: number) => void)} moveTo
 */

/**
 * @typedef {object} Logger
 * @property {((url: string) => void)} initialized
 * @property {(<T extends unknown>(message: T & { type: string; subType: string; }) => void)} remote
 * @property {(<T extends unknown>(label: string, ...details: T) => void)} execute
 */

export const TARGET_HOSTS = ["localhost", "frontend-dev.octoplay.dev"];