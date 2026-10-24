import type { StateStore, StateKey, StateChangeSubscriber } from "../shared/types";

const STORAGE_AREA = "local";

export function createStore<State extends object>(initialState: State): StateStore<State> {
  const keys = Object.keys(initialState) as StateKey<State>[];
  const state = { ...initialState };
  const listeners: Set<StateChangeSubscriber<State>> = new Set();

  const notify = () => listeners.forEach((listener) => listener(state));

  const set = async <K extends keyof State>(key: K, value: State[K]) => {
    try {
      await chrome.storage[STORAGE_AREA].set({ [key]: value });
    } catch (err) {
      console.warn("Error setting value", err);
    }
  };

  const subscribe = (listener: StateChangeSubscriber<State>) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const ready: Promise<State> = new Promise<State>((resolve) => {
    chrome.storage[STORAGE_AREA].get<Partial<State>>(keys, (stored) => {
      keys.forEach((key) => {
        state[key] = stored[key] ?? initialState[key];
      });
      notify();
      resolve(state);
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== STORAGE_AREA) return;

    let dirty = false;
    keys.forEach((key) => {
      if (!(key in changes)) return;
      const change = changes[key];
      if (!change) return;
      const value = change.newValue ?? initialState[key];
      state[key] = value as State[typeof key]
      dirty = true;
    });

    if (dirty) notify();
  });

  return {
    state,
    ready,
    set,
    subscribe,
  }
}