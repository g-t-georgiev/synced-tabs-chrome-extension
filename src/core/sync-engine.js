/** @typedef {import("../constants.js").Feature} TFeature */

/**
 * @template {import("../constants.js").StateConfig} State
 * @param {object} options
 * @param {import("../constants.js").StateStore<State>} options.config
 * @param {import("../constants.js").MessageController} options.transport
 * @param {import("../constants.js").UIController} options.ui
 * @param {import("../constants.js").Logger} options.logger
 * @returns {import("../constants.js").SyncEngine}
 */
export function createSyncEngine({ config, transport, ui, logger }) {
  /** @type {Map<string, TFeature>} */
  const routes = new Map();
  /** @type {TFeature[]} */
  const features = [];
  /** @type {(() => any)[]} */
  const teardowns = [];

  /**
   * @param {import("../constants.js").Message} message
   * @returns {void}
   */
  function handleRemote(message) {
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
      features.forEach((feature) => teardowns.push(feature.capture()));
      teardowns.push(transport.onRemote(handleRemote));
    },
    stop() {
      teardowns.splice(0).forEach((teardown) => teardown?.());
    }
  };
}