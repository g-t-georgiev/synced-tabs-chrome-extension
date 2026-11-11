import { DEFAULT_CONFIG, MESSAGE_TYPES } from "./constants";

export type StateConfig = typeof DEFAULT_CONFIG;
export type StateConfigKey = keyof StateConfig;
export type StateChangeSubscriber<State> = (state: State) => unknown;

export interface StateStore<State extends object> {
  state: State;
  ready: Promise<State>;
  set<K extends keyof State>(key: K, value: State[K]): Promise<void>;
  subscribe(listener: StateChangeSubscriber<State>): () => boolean;
}

export type StateKey<State extends object> = Extract<keyof State, string>;

export type MessageTypes = typeof MESSAGE_TYPES;
export type MessageType = MessageTypes[keyof MessageTypes];

export interface KeyboardEventData {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly which: number;
  readonly charCode: number;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
}

export interface MessagePayload {
  type: string;
  subType: string;
  isDocument: boolean;
  keyData: KeyboardEventData;
  xRatio: number;
  yRatio: number;
  xPoint: number;
  yPoint: number;
  button: number;
  buttons: number;
}

/** A frame's viewport size in CSS px (`innerWidth` × `innerHeight`). */
export interface Viewport {
  w: number;
  h: number;
}

export type Message<T = MessagePayload> = T & {
  action: string;
  originWindowId: string;
  /** Sender frame's position in its tab's frame tree (see `getFramePath`). */
  framePath: string;
  /** Sender frame's viewport. Absent in messages from older builds. */
  viewport?: Viewport;
};

/** What a receiving frame did with a mirrored message. */
export type ApplyResult =
  | { status: "applied" }
  /** Not applied because the position can't be trusted; `viewport` is the receiver's. */
  | { status: "dropped"; reason: "viewport-mismatch"; viewport: Viewport };

/** What a receiver handler may answer: nothing, a result, or a result later. */
export type RemoteResult = ApplyResult | void | Promise<ApplyResult | void>;

export type DeliveryStatus = "delivered" | "unreachable";

export interface TabDelivery {
  tabId: number;
  status: DeliveryStatus;
  /** The receiving frame's answer, when it gave one. */
  result?: ApplyResult;
}

/** The worker's answer to a broadcast sent with `report`. */
export interface DeliveryReport {
  results: TabDelivery[];
}

export interface BroadcastOptions {
  /**
   * Ask every receiver what it did and show drops as toasts in this tab. The value names
   * what was mirrored, for the toast text: "Clicks" → "Clicks were not mirrored to …".
   */
  report?: string;
}

export interface MessageController {
  broadcast<T>(payload: T, options?: BroadcastOptions): void;
  onRemote<T>(handler: (message: Message<T>) => RemoteResult): () => void;
}

export interface Feature<TKey extends PropertyKey = StateConfigKey, TPayload = MessagePayload> {
  configKey: TKey;
  handles: MessageType[];
  silent: boolean;
  capture(): () => void;
  /** Returns a drop when the message can't be applied here; nothing means applied. */
  apply(message: Message<TPayload>): ApplyResult | void;
}

export interface SyncEngine<State extends object = StateConfig> {
  register(feature: Feature<keyof State>): void;
  /** Resolves once stored settings have loaded and captures are running. */
  start(): Promise<void>;
  stop(): void;
}

export interface UIController {
  flash(): void;
  pulse(): void;
}

export interface CursorController {
  moveTo(x: number, y: number): void;
}

export interface Logger {
  initialized(url: string): void;
  remote<T extends unknown>(message: T & { type: string; subType: string }): void;
  execute<T extends unknown[]>(label: string, ...details: T): void;
}

export type NoticeLevel = "warning" | "error";

export interface NoticeOptions {
  /**
   * Identifies a notice so repeats refresh one toast (with a repeat count) instead of
   * stacking copies. Defaults to the level plus the text.
   */
  key?: string;
  /** How long the toast stays up, from its latest refresh. */
  durationMs?: number;
}

/** Shows transient toasts in the tab's top-level viewport, never in other tabs. */
export interface Notifier {
  warn(text: string, options?: NoticeOptions): void;
  error(text: string, options?: NoticeOptions): void;
}

export interface NoticeMessage {
  action: string;
  level: NoticeLevel;
  text: string;
  options?: NoticeOptions;
}

export interface ScrollEcho {
  top: number;
  left: number;
}
