import { DEFAULT_CONFIG, MESSAGE_TYPES } from "./constants";

export type StateConfig = typeof DEFAULT_CONFIG;
export type StateConfigKey = keyof StateConfig;
export type StateChangeSubscriber<State> = (state: State) => unknown;

export interface StateStore<State extends object> {
  state: State;
  ready: Promise<State>;
  set<K extends keyof State>(key: K, value: State[K]): Promise<void>;
  subscribe(listener: (StateChangeSubscriber<State>)): (() => boolean);
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
}

export type Message<T = MessagePayload> = T & { action: string; originWindowId: string; };
export interface MessageController {
  broadcast<T>(payload: T): void;
  onRemote<T>(handler: ((message: Message<T>) => void)): (() => void);
}

export interface Feature<
  TKey extends PropertyKey = StateConfigKey,
  TPayload = MessagePayload
> {
  configKey: TKey;
  handles: MessageType[];
  silent: boolean;
  capture(): (() => void);
  apply(message: Message<TPayload>): any;
}

export interface SyncEngine<State extends object = StateConfig> {
  register(feature: Feature<keyof State>): void;
  start(): void;
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
  remote<T extends unknown>(message: T & { type: string; subType: string; }): void;
  execute<T extends unknown[]>(label: string, ...details: T): void;
}