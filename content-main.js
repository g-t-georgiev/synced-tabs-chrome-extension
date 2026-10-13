import { DEFAULT_CONFIG } from "./src/constants.js";
import {
  createStore,
  createLogger,
  createWindowId,
  createTransport,
  createSyncEngine
} from "./src/core/index.js";
import { createPanel, createCursor, createNullUi } from "./src/ui/index.js";
import {
  createCursorSync,
  createScrollSync,
  createPointerSync,
  createKeyboardSync
} from "./src/features/index.js";

export function main() {
  const windowId = createWindowId();
  const logger = createLogger(windowId);
  const config = createStore({ ...DEFAULT_CONFIG });
  const transport = createTransport({ windowId });
  const ui = window.top === window
    ? createPanel({ windowId, config })
    : createNullUi();
  const cursor = createCursor();

  const engine = createSyncEngine({ config, transport, ui, logger });
  engine.register(createCursorSync({ config, transport, cursor }));
  engine.register(createPointerSync({ config, transport, logger }));
  engine.register(createKeyboardSync({ config, transport, logger }));
  engine.register(createScrollSync({ config, transport }));
  engine.start();

  logger.initialized(window.location.href);
}