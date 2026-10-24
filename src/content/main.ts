import { DEFAULT_CONFIG } from "../shared/constants";
import {
  createStore,
  createLogger,
  createWindowId,
  createTransport,
  createSyncEngine
} from "../core";
import { createPanel, createCursor, createNullUi } from "../ui";
import {
  createCursorSync,
  createScrollSync,
  createPointerSync,
  createKeyboardSync
} from "../features";

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
  engine.register(createCursorSync({ transport, cursor }));
  engine.register(createPointerSync({ transport, logger }));
  engine.register(createKeyboardSync({ transport, logger }));
  engine.register(createScrollSync({ transport }));
  engine.start();

  logger.initialized(window.location.href);
}