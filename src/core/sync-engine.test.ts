import { describe, expect, it, vi } from "vite-plus/test";
import type {
  Feature,
  Message,
  MessageController,
  StateChangeSubscriber,
  StateStore,
} from "../shared/types";
import { createSyncEngine } from "./sync-engine";

type State = { syncA: boolean; syncB: boolean };

function setup(
  initial: State = { syncA: true, syncB: false },
  ready: Promise<State> = Promise.resolve(initial),
) {
  const subscribers = new Set<StateChangeSubscriber<State>>();
  const config: StateStore<State> = {
    state: { ...initial },
    ready,
    set: vi.fn(async () => {}),
    subscribe: vi.fn((listener) => {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    }),
  };
  const update = (patch: Partial<State>) => {
    Object.assign(config.state, patch);
    subscribers.forEach((listener) => listener(config.state));
  };

  let remote: ((message: Message<any>) => void) | undefined;
  const unsubscribeRemote = vi.fn();
  const transport: MessageController = {
    broadcast: vi.fn(),
    onRemote: vi.fn((handler) => {
      remote = handler as typeof remote;
      return unsubscribeRemote;
    }),
  };
  const ui = { flash: vi.fn(), pulse: vi.fn() };
  const logger = { initialized: vi.fn(), remote: vi.fn(), execute: vi.fn() };

  const engine = createSyncEngine({ config, transport, ui, logger });
  const receive = (type: string) =>
    remote?.({ type, subType: "", action: "", originWindowId: "w", framePath: "" } as Message<any>);

  return { engine, update, ui, logger, subscribers, unsubscribeRemote, receive };
}

function createFeature(configKey: keyof State, handles: string[], silent = false) {
  const teardown = vi.fn();
  const capture = vi.fn(() => teardown);
  const apply = vi.fn();
  const feature = { configKey, handles, silent, capture, apply } as unknown as Feature<keyof State>;
  return { feature, capture, apply, teardown };
}

describe("createSyncEngine", () => {
  it("captures only features enabled in config on start", async () => {
    const { engine } = setup();
    const a = createFeature("syncA", ["A"]);
    const b = createFeature("syncB", ["B"]);
    engine.register(a.feature);
    engine.register(b.feature);

    await engine.start();

    expect(a.capture).toHaveBeenCalledOnce();
    expect(b.capture).not.toHaveBeenCalled();
  });

  it("starts and tears down captures as config toggles", async () => {
    const { engine, update } = setup();
    const a = createFeature("syncA", ["A"]);
    const b = createFeature("syncB", ["B"]);
    engine.register(a.feature);
    engine.register(b.feature);
    await engine.start();

    update({ syncA: false, syncB: true });

    expect(a.teardown).toHaveBeenCalledOnce();
    expect(b.capture).toHaveBeenCalledOnce();

    update({ syncB: true });
    expect(b.capture).toHaveBeenCalledOnce();
  });

  it("rejects a feature whose message types are already handled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { engine, receive } = setup({ syncA: true, syncB: true });
    const first = createFeature("syncA", ["A"]);
    const duplicate = createFeature("syncB", ["A", "B"]);
    engine.register(first.feature);
    engine.register(duplicate.feature);
    await engine.start();

    receive("B");

    expect(warn).toHaveBeenCalledWith("Duplicate handler for A");
    expect(duplicate.capture).not.toHaveBeenCalled();
    expect(duplicate.apply).not.toHaveBeenCalled();
  });

  it("applies remote messages for enabled features with UI feedback", async () => {
    const { engine, receive, ui, logger } = setup();
    const a = createFeature("syncA", ["A"]);
    engine.register(a.feature);
    await engine.start();

    receive("A");

    expect(a.apply).toHaveBeenCalledOnce();
    expect(ui.flash).toHaveBeenCalledOnce();
    expect(ui.pulse).toHaveBeenCalledOnce();
    expect(logger.remote).toHaveBeenCalledOnce();
  });

  it("flashes and logs but does not apply messages for disabled features", async () => {
    const { engine, receive, ui, logger } = setup();
    const b = createFeature("syncB", ["B"]);
    engine.register(b.feature);
    await engine.start();

    receive("B");

    expect(b.apply).not.toHaveBeenCalled();
    expect(ui.flash).toHaveBeenCalledOnce();
    expect(logger.remote).toHaveBeenCalledOnce();
    expect(ui.pulse).not.toHaveBeenCalled();
  });

  it("applies silent features without UI feedback or logging", async () => {
    const { engine, receive, ui, logger } = setup();
    const a = createFeature("syncA", ["A"], true);
    engine.register(a.feature);
    await engine.start();

    receive("A");

    expect(a.apply).toHaveBeenCalledOnce();
    expect(ui.flash).not.toHaveBeenCalled();
    expect(ui.pulse).not.toHaveBeenCalled();
    expect(logger.remote).not.toHaveBeenCalled();
  });

  it("ignores messages with no registered handler", async () => {
    const { engine, receive, ui } = setup();
    await engine.start();

    receive("UNKNOWN");

    expect(ui.flash).not.toHaveBeenCalled();
  });

  it("stop() tears down captures and subscriptions", async () => {
    const { engine, subscribers, unsubscribeRemote } = setup();
    const a = createFeature("syncA", ["A"]);
    engine.register(a.feature);
    await engine.start();

    engine.stop();

    expect(a.teardown).toHaveBeenCalledOnce();
    expect(subscribers.size).toBe(0);
    expect(unsubscribeRemote).toHaveBeenCalledOnce();
  });

  describe("before stored settings load", () => {
    function deferredSetup() {
      let resolve!: (state: State) => void;
      const loading = new Promise<State>((done) => (resolve = done));
      const harness = setup({ syncA: true, syncB: false }, loading);
      const load = async (stored: State) => {
        harness.update(stored); // the store applies stored values before resolving
        resolve(stored);
        await loading;
      };
      return { ...harness, load };
    }

    it("listens for remote messages immediately but does not capture yet", () => {
      const { engine, receive } = deferredSetup();
      const a = createFeature("syncA", ["A"]);
      engine.register(a.feature);

      void engine.start();
      receive("A");

      expect(a.capture).not.toHaveBeenCalled();
      expect(a.apply).not.toHaveBeenCalled();
    });

    it("captures by the stored settings, not the defaults", async () => {
      const { engine, load } = deferredSetup();
      const a = createFeature("syncA", ["A"]);
      const b = createFeature("syncB", ["B"]);
      engine.register(a.feature);
      engine.register(b.feature);

      const started = engine.start();
      await load({ syncA: false, syncB: true });
      await started;

      expect(a.capture).not.toHaveBeenCalled();
      expect(b.capture).toHaveBeenCalledOnce();
    });

    it("replays early messages in order under the stored settings", async () => {
      const { engine, receive, load } = deferredSetup();
      const order: string[] = [];
      const a = createFeature("syncA", ["A"]);
      const b = createFeature("syncB", ["B"]);
      a.apply.mockImplementation(() => order.push("A"));
      b.apply.mockImplementation(() => order.push("B"));
      engine.register(a.feature);
      engine.register(b.feature);

      const started = engine.start();
      receive("B");
      receive("A");
      receive("B");
      await load({ syncA: false, syncB: true });
      await started;

      expect(order).toEqual(["B", "B"]); // A is off in the stored settings
    });

    it("does not capture if stopped before settings load", async () => {
      const { engine, load, subscribers } = deferredSetup();
      const a = createFeature("syncA", ["A"]);
      engine.register(a.feature);

      const started = engine.start();
      engine.stop();
      await load({ syncA: true, syncB: false });
      await started;

      expect(a.capture).not.toHaveBeenCalled();
      expect(subscribers.size).toBe(0);
    });
  });
});
