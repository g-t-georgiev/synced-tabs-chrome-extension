import type { NoticeLevel, NoticeMessage, NoticeOptions, Notifier } from "../shared/types";
import { ACTIONS } from "../shared/constants";
import { OWN_UI_ATTR } from "../dom";

const DEFAULT_DURATION_MS: Record<NoticeLevel, number> = {
  warning: 4000,
  error: 6000,
};
/** Oldest toasts give way beyond this many. */
const MAX_TOASTS = 4;

const STYLES = `
  .stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .toast {
    display: flex;
    align-items: baseline;
    gap: 8px;
    max-width: 360px;
    padding: 6px 10px;
    border: 1px solid;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(4px);
    font: 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    pointer-events: auto;
    cursor: pointer;
    user-select: none;
    animation: enter 0.15s ease-out;
  }
  .toast.warning {
    border-color: #ffcc00;
    color: #ffcc00;
  }
  .toast.error {
    border-color: #ff4d4f;
    color: #ff4d4f;
  }
  .count {
    font-weight: bold;
    opacity: 0.8;
  }
  .count:empty {
    display: none;
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
`;

interface Toast {
  element: HTMLElement;
  text: HTMLElement;
  count: HTMLElement;
  repeats: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Renders toasts bottom-right in this frame. Use in the top frame; child frames use
 * {@link createRelayNotifier} so toasts appear in the tab's main viewport.
 */
export function createNotifier(): Notifier {
  const host = document.createElement("div");
  host.setAttribute(OWN_UI_ATTR, "");
  host.style.cssText = [
    "position: fixed",
    "right: 12px",
    "bottom: 12px",
    "z-index: 2147483647",
    "pointer-events: none",
  ].join("; ");

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${STYLES}</style><div class="stack" role="status" aria-live="polite"></div>`;
  const stack = shadow.querySelector<HTMLElement>(".stack")!;
  const toasts: Map<string, Toast> = new Map();

  if (document.body) document.body.append(host);
  else
    window.addEventListener("DOMContentLoaded", () => document.body.append(host), { once: true });

  function dismiss(key: string) {
    const toast = toasts.get(key);
    if (!toast) return;
    clearTimeout(toast.timer);
    toast.element.remove();
    toasts.delete(key);
  }

  function create(key: string): Toast {
    const element = document.createElement("div");
    const text = document.createElement("span");
    const count = document.createElement("span");
    count.className = "count";
    element.append(text, count);
    element.addEventListener("click", () => dismiss(key));
    return { element, text, count, repeats: 0, timer: undefined };
  }

  function show(level: NoticeLevel, text: string, options: NoticeOptions = {}) {
    const key = options.key ?? `${level}:${text}`;
    const toast = toasts.get(key) ?? create(key);

    toast.repeats += 1;
    toast.element.className = `toast ${level}`;
    toast.text.textContent = text;
    toast.count.textContent = toast.repeats > 1 ? `×${toast.repeats}` : "";

    // (Re)insert as the newest toast, at the bottom of the stack.
    toasts.delete(key);
    toasts.set(key, toast);
    stack.append(toast.element);

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => dismiss(key), options.durationMs ?? DEFAULT_DURATION_MS[level]);

    for (const oldest of toasts.keys()) {
      if (toasts.size <= MAX_TOASTS) break;
      dismiss(oldest);
    }
  }

  return {
    warn: (text, options) => show("warning", text, options),
    error: (text, options) => show("error", text, options),
  };
}

/** Shows relayed child-frame notices with `notifier`. Returns an unsubscribe function. */
export function listenForRelayedNotices(notifier: Notifier) {
  const listener = (message: Partial<NoticeMessage> | undefined) => {
    if (message?.action !== ACTIONS.NOTIFY || typeof message.text !== "string") return;
    if (message.level === "error") notifier.error(message.text, message.options);
    else notifier.warn(message.text, message.options);
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** Notifier for child frames: forwards notices to the tab's top frame via the worker. */
export function createRelayNotifier(): Notifier {
  const relay = (level: NoticeLevel, text: string, options?: NoticeOptions) => {
    const message: NoticeMessage = { action: ACTIONS.NOTIFY, level, text, options };
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // Extension context gone (extension reloaded): nowhere to show it.
    }
  };

  return {
    warn: (text, options) => relay("warning", text, options),
    error: (text, options) => relay("error", text, options),
  };
}
