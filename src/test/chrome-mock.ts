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
export function installChromeMock(stored: Record<string, unknown> = {}) {
  const data = { ...stored };

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
      sendMessage: vi.fn(async (_message: unknown) => undefined),
      onMessage: createEvent<[any, chrome.runtime.MessageSender?]>(),
    },
  };

  vi.stubGlobal("chrome", chromeMock);
  return chromeMock;
}
