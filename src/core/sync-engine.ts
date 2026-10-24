import type {
  StateStore,
  Logger,
  MessageController,
  StateConfig,
  SyncEngine,
  UIController,
  Feature,
  Message
} from "../shared/types";

export function createSyncEngine<State extends object>(
  { config, transport, ui, logger }:
  {
    config: StateStore<State>,
    transport: MessageController,
    ui: UIController,
    logger: Logger
  }
): SyncEngine<State> {
  const routes: Map<string, Feature<keyof State>> = new Map();
  const features: Feature<keyof State>[] = [];
  const teardowns: (() => any)[] = [];
  const activeCaptures: Map<Feature<keyof State>, (() => any)> = new Map();

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
    start() {
      syncCaptures(config.state);
      teardowns.push(config.subscribe(syncCaptures));
      teardowns.push(transport.onRemote(handleRemote));
    },
    stop() {
      teardowns.splice(0).forEach((teardown) => teardown());
      activeCaptures.forEach((teardown) => teardown());
      activeCaptures.clear();
    }
  };
}