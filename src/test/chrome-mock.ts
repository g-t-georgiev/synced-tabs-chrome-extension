import { vi } from "vite-plus/test";

type Listener<Args extends unknown[]> = (...args: Args) => unknown;

/** Minimal event target mirroring `chrome.events.Event`, with a `fire` helper for tests. */
function createEvent<Args extends unknown[]>() {
  const listeners = new Set<Listener<Args>>();
  return {
    addListener: vi.fn((listener: Listener<Args>) => listeners.add(listener)),
    removeListener: vi.fn((listener: Listener<Args>) => listeners.delete(listener)),
    hasListeners: () => listeners.size > 0,
    fire: (...args: Args) => listeners.forEach((listener) => listener(...args)),
  };
}

/**
 * Stubs the subset of the `chrome` API the extension uses and installs it as a global.
 * `storage.local` is backed by an in-memory record seeded from `stored`.
 */
export function installChromeMock(
  stored: Record<string, unknown> = {},
  openTabs: Array<Partial<chrome.tabs.Tab>> = [],
) {
  const data = { ...stored };
  const onMessage =
    createEvent<[any, chrome.runtime.MessageSender, (response?: unknown) => void]>();

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn((keys: string[], callback: (items: Record<string, unknown>) => void) => {
          const items: Record<string, unknown> = {};
          keys.forEach((key) => {
            if (key in data) items[key] = data[key];
          });
          queueMicrotask(() => callback(items));
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(data, items);
        }),
      },
      onChanged:
        createEvent<[Record<string, { oldValue?: unknown; newValue?: unknown }>, string]>(),
    },
    runtime: {
      /** Real Chrome clears this once the extension context is invalidated. */
      id: "test-extension" as string | undefined,
      sendMessage: vi.fn(async (_message: unknown) => undefined as unknown),
      onMessage: {
        ...onMessage,
        /** Like Chrome, always passes a sender and a `sendResponse` (a no-op by default). */
        fire: (
          message: any,
          sender: chrome.runtime.MessageSender = {},
          sendResponse: (response?: unknown) => void = () => {},
        ) => onMessage.fire(message, sender, sendResponse),
      },
    },
    tabs: {
      query: vi.fn(async (_query: chrome.tabs.QueryInfo) => openTabs),
      get: vi.fn(async (tabId: number) => {
        const tab = openTabs.find((candidate) => candidate.id === tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      }),
      sendMessage: vi.fn(
        async (_tabId: number, _message: unknown, _options?: chrome.tabs.MessageSendOptions) =>
          undefined as unknown,
      ),
      onUpdated: createEvent<[number, chrome.tabs.OnUpdatedInfo, Partial<chrome.tabs.Tab>]>(),
      onRemoved: createEvent<[number, chrome.tabs.OnRemovedInfo?]>(),
      onReplaced: createEvent<[number, number]>(),
    },
    scripting: {
      executeScript: vi.fn(
        async (_injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => [],
      ),
    },
  };

  vi.stubGlobal("chrome", chromeMock);
  return chromeMock;
}
