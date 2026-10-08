const STORAGE_AREA = "local";

/**
 * @template {unknown} State
 * @param {State} initialState 
 */
export function createStore(initialState) {
  /** @typedef {(keyof State)} StateKey */
  /** @typedef {((state: State) => unknown)} StateChangeSubscriber */

  /** @type {StateKey[]} */
  const keys = Object.keys(initialState);
  /** @type {State} */
  const state = { ...initialState };
  /** @type {Set<StateChangeSubscriber>} */
  const listeners = new Set();

  const notify = () => listeners.forEach((listener) => listener(state));
  /**
   * @template {StateKey} T
   * @param {T} key
   * @param {State[T]} value
   */
  const set = async (key, value) => {
    try {
      await chrome.storage[STORAGE_AREA].set({ [key]: value });
    } catch (err) {
      console.warn("Error setting value", err);
    }
  };
  /**
   * @param {StateChangeSubscriber} listener 
   * @returns {(() => boolean)}
   */
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  /** @type {Promise<State>} */
  const ready = new Promise((resolve) => {
    chrome.storage[STORAGE_AREA].get(keys, (stored) => {
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
      state[key] = changes[keys].newValue ?? initialState[key];
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