import { describe, expect, it, vi } from "vite-plus/test";
import { installChromeMock } from "../test/chrome-mock";
import { createStore } from "./state-store";

const initial = { syncMouse: false, syncKeyboard: true };

describe("createStore", () => {
  it("resolves ready with stored values, falling back to initial ones", async () => {
    installChromeMock({ syncMouse: true });
    const store = createStore(initial);

    await expect(store.ready).resolves.toEqual({ syncMouse: true, syncKeyboard: true });
    expect(store.state).toEqual({ syncMouse: true, syncKeyboard: true });
  });

  it("does not mutate the initial state object", async () => {
    installChromeMock({ syncMouse: true });
    await createStore(initial).ready;

    expect(initial).toEqual({ syncMouse: false, syncKeyboard: true });
  });

  it("notifies subscribers once storage has loaded", async () => {
    installChromeMock();
    const store = createStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.ready;

    expect(listener).toHaveBeenCalledWith(store.state);
  });

  it("writes through to chrome.storage.local", async () => {
    const chrome = installChromeMock();
    const store = createStore(initial);

    await store.set("syncMouse", true);

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ syncMouse: true });
  });

  it("logs instead of throwing when the storage write fails", async () => {
    const chrome = installChromeMock();
    chrome.storage.local.set.mockRejectedValueOnce(new Error("quota"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createStore(initial);

    await expect(store.set("syncMouse", true)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("applies local storage changes for known keys and notifies", async () => {
    const chrome = installChromeMock();
    const store = createStore(initial);
    await store.ready;
    const listener = vi.fn();
    store.subscribe(listener);

    chrome.storage.onChanged.fire(
      { syncMouse: { newValue: true }, unrelated: { newValue: 1 } },
      "local",
    );

    expect(store.state.syncMouse).toBe(true);
    expect(store.state).not.toHaveProperty("unrelated");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("resets a removed key to its initial value", async () => {
    const chrome = installChromeMock({ syncKeyboard: false });
    const store = createStore(initial);
    await store.ready;

    chrome.storage.onChanged.fire({ syncKeyboard: { oldValue: false } }, "local");

    expect(store.state.syncKeyboard).toBe(true);
  });

  it("ignores changes from other storage areas or unknown keys", async () => {
    const chrome = installChromeMock();
    const store = createStore(initial);
    await store.ready;
    const listener = vi.fn();
    store.subscribe(listener);

    chrome.storage.onChanged.fire({ syncMouse: { newValue: true } }, "sync");
    chrome.storage.onChanged.fire({ other: { newValue: true } }, "local");

    expect(store.state.syncMouse).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", async () => {
    const chrome = installChromeMock();
    const store = createStore(initial);
    await store.ready;
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    chrome.storage.onChanged.fire({ syncMouse: { newValue: true } }, "local");

    expect(listener).not.toHaveBeenCalled();
  });
});
