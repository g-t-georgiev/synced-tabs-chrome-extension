import type {
  StateStore,
  Logger,
  MessageController,
  SyncEngine,
  UIController,
  Feature,
  Message,
} from "../shared/types";

export function createSyncEngine<State extends object>({
  config,
  transport,
  ui,
  logger,
}: {
  config: StateStore<State>;
  transport: MessageController;
  ui: UIController;
  logger: Logger;
}): SyncEngine<State> {
  const routes: Map<string, Feature<keyof State>> = new Map();
  const features: Feature<keyof State>[] = [];
  const teardowns: (() => any)[] = [];
  const activeCaptures: Map<Feature<keyof State>, () => any> = new Map();
  /** Remote messages that arrived before stored settings loaded, replayed in order. */
  const early: Message[] = [];
  let loaded = false;
  let running = false;

  function syncCaptures(state: State) {
    for (const feature of features) {
      const enabled = Boolean(state[feature.configKey]);
      const teardown = activeCaptures.get(feature);

      if (enabled && !teardown) {
        activeCaptures.set(feature, feature.capture());
      } else if (!enabled && teardown) {
        teardown();
        activeCaptures.delete(feature);
      }
    }
  }

  function receive(message: Message): void {
    if (loaded) handleRemote(message);
    else early.push(message);
  }

  function handleRemote(message: Message): void {
    const feature = routes.get(message.type);
    if (!feature) return;

    const enabled = Boolean(config.state[feature.configKey]);

    if (feature.silent) {
      if (enabled) feature.apply(message);
      return;
    }

    ui.flash();
    logger.remote(message);

    if (!enabled) return;

    ui.pulse();
    feature.apply(message);
  }

  return {
    register(feature) {
      const taken = feature.handles.filter((type) => routes.has(type));

      if (taken.length) {
        console.warn(`Duplicate handler for ${taken.join(", ")}`);
        return;
      }

      feature.handles.forEach((type) => routes.set(type, feature));
      features.push(feature);
    },
    /**
     * Listens for remote messages immediately (the background worker re-sends right after
     * injecting the content script), but starts capturing only once stored settings have
     * loaded, so a feature the user turned off never captures with its default. Messages
     * received before then are applied, or dropped, under the loaded settings.
     */
    async start() {
      running = true;
      teardowns.push(transport.onRemote(receive));

      await config.ready;
      if (!running) return;

      loaded = true;
      early.splice(0).forEach(handleRemote);
      syncCaptures(config.state);
      teardowns.push(config.subscribe(syncCaptures));
    },
    stop() {
      running = false;
      loaded = false;
      early.length = 0;
      teardowns.splice(0).forEach((teardown) => teardown());
      activeCaptures.forEach((teardown) => teardown());
      activeCaptures.clear();
    },
  };
}
