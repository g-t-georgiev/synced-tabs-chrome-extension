/**
 * @template {import("../constants.js").StateConfigKey} TKey
 * @template {Partial<import("../constants.js").MessagePayload>} TPayload
 * @typedef {object} Feature
 * @property {TKey} configKey
 * @property {(import("../constants.js").MessageType)[]} handles
 * @property {boolean} silent
 * @property {(() => (() => void))} capture
 * @property {((message: import("../core/messaging.js").Message<TPayload>) => any)} apply
 */

/** @typedef {Feature<import("../constants.js").StateConfigKey, import("../constants.js").MessagePayload>} TFeature */

/**
 * @template {import("../constants.js").StateConfig} State
 * @param {object} options
 * @param {ReturnType<typeof import("../core/state-store.js").createStore<State>>} options.config
 * @param {ReturnType<typeof import("../core/messaging.js").createTransport>} options.transport
 * @param {ReturnType<typeof import("../ui/panel.js").createPanel>} options.ui
 * @param {ReturnType<typeof import("../core/logger.js").createLogger>} options.logger
 */
export function createSyncEngine({ config, transport, ui, logger }) {
  /** @type {Map<string, TFeature>} */
  const routes = new Map();
  /** @type {TFeature[]} */
  const features = [];
  /** @type {(() => any)[]} */
  const teardowns = [];

  /**
   * @param {import("../core/messaging.js").Message<import("../constants.js").MessagePayload>} message
   * @returns
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
    /** @param {TFeature} feature */
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