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
  createRelayCursor,
  listenForCursorRelays,
  createFieldHighlight,
} from "../ui";
import {
  createCursorSync,
  createScrollSync,
  createPointerSync,
  createKeyboardSync,
  createPanelSync,
  createTextSync,
  createTextFocusSync,
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
  // One ghost cursor, in the top frame. Child frames hand points up to their parent, which
  // shifts them by the iframe's position, until they reach the top frame.
  const cursor = isTop ? createCursor() : createRelayCursor();
  listenForCursorRelays(cursor);

  const engine = createSyncEngine({ config, transport, ui, logger });
  engine.register(createCursorSync({ transport, cursor }));
  engine.register(createPointerSync({ transport, logger }));
  engine.register(createKeyboardSync({ transport, logger }));
  engine.register(createScrollSync({ transport }));
  engine.register(createTextSync({ transport }));
  // Fields can live in any frame, so each frame draws its own ring over its own fields.
  engine.register(createTextFocusSync({ transport, highlight: createFieldHighlight() }));
  if (panel) engine.register(createPanelSync({ transport, panel }));
  // Listens right away; captures start once stored settings have loaded.
  void engine.start();

  logger.initialized(window.location.href);
}
