import { DEFAULT_CONFIG } from "../shared/constants";
import {
  createStore,
  createLogger,
  createWindowId,
  createTransport,
  createSyncEngine,
} from "../core";
import {
  createPanel,
  createCursor,
  createNullUi,
  createNotifier,
  createRelayNotifier,
  listenForRelayedNotices,
} from "../ui";
import {
  createCursorSync,
  createScrollSync,
  createPointerSync,
  createKeyboardSync,
  createPanelSync,
} from "../features";

export function main() {
  const windowId = createWindowId();
  const logger = createLogger(windowId);
  const config = createStore({ ...DEFAULT_CONFIG });
  const isTop = window.top === window;
  // Toasts render only in the top frame; child frames relay theirs to it.
  const notifier = isTop ? createNotifier() : createRelayNotifier();
  if (isTop) listenForRelayedNotices(notifier);
  const transport = createTransport({ windowId, notifier });
  // The panel lives in the top frame only.
  const panel = isTop ? createPanel({ windowId, config }) : null;
  const ui = panel ?? createNullUi();
  const cursor = createCursor();

  const engine = createSyncEngine({ config, transport, ui, logger });
  engine.register(createCursorSync({ transport, cursor }));
  engine.register(createPointerSync({ transport, logger }));
  engine.register(createKeyboardSync({ transport, logger }));
  engine.register(createScrollSync({ transport }));
  if (panel) engine.register(createPanelSync({ transport, panel }));
  // Listens right away; captures start once stored settings have loaded.
  void engine.start();

  logger.initialized(window.location.href);
}
