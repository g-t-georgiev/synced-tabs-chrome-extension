import { ACTIONS, DEFAULT_CONFIG, MESSAGE_TYPES } from "./src/constants.js";
import { createStore } from "./src/core/state-store.js";
import {
  pointToRatio,
  ratioToPoint,
  ratioToScrollOffset,
  rectCenterToRatio,
  elementCenterToRatio,
  scrollOffsetToRatio
} from "./src/dom/coordinates.js";
import { elementAt, findScrollableAncestor } from "./src/dom/element-resolver.js";
import { rAfThrottle } from "./src/dom/raf-throttle.js";
import {
  buildKeyboardEventData,
  dispatchSyntheticKeyboardEvent,
  dispatchSyntheticPointerEvent,
  isPointerEventSupported
} from "./src/dom/synthetic-events.js";

export function main() {
  const WINDOW_ID = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2) + Date.now().toString(36);

  let syncedKeyTarget = null;
  let ghostCursorTimeout = null;

  const config = { ...DEFAULT_CONFIG };
  // Test store
  const test = createStore({ ...DEFAULT_CONFIG });

  // UI Elements
  const { panel, badge, state } = createControlPanel();
  const ghostCursor = createGhostCursor();

  console.log(`%c[SYNC INITIALIZED]%c Window ID [${WINDOW_ID.slice(0, 8)}] URL: ${window.location.href}`, "color: #00ff00; font-weight: bold;", "color: default;");
  const pointerPrefix = isPointerEventSupported() ? "pointer" : "mouse";

  // 1. CAPTURE & BROADCAST MOUSE/POINTER CLICKS
  [`${pointerPrefix}down`, `${pointerPrefix}up`, "click"].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (!event.isTrusted || !state.syncMouse) return;

      const ratio = pointToRatio(event.clientX, event.clientY);

      chrome.runtime.sendMessage({
        action: ACTIONS.BROADCAST,
        originWindowId: WINDOW_ID,
        type: MESSAGE_TYPES.POINTER_EVENT,
        subType: type,
        xRatio: ratio.x,
        yRatio: ratio.y
      }).catch(() => { });
    }, true);
  });

  // 2. CAPTURE & BROADCAST GHOST CURSOR MOVEMENT
  const broadcastCursor = rAfThrottle(
    /**
     * @param {number} xRatio
     * @param {number} yRatio
     */
    (xRatio, yRatio) => {
      chrome.runtime.sendMessage({
        action: ACTIONS.BROADCAST,
        originWindowId: WINDOW_ID,
        type: MESSAGE_TYPES.POINTER_MOVE,
        xRatio,
        yRatio
      }).catch(() => { });
    }
  );

  window.addEventListener(`${pointerPrefix}move`, (event) => {
    if (!event.isTrusted || !state.syncCursor) return;
    const ratio = pointToRatio(event.clientX, event.clientY);
    broadcastCursor(ratio.x, ratio.y);
  }, { capture: true, passive: true });

  // 3. CAPTURE & BROADCAST KEYBOARD EVENTS
  ["keydown", "keypress", "keyup"].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (!event.isTrusted || !state.syncKeyboard) return;

      const originTarget = event.target || document.activeElement || document.body;
      const rect = originTarget.getBoundingClientRect ? originTarget.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const ratio = rectCenterToRatio(rect);
      const keyData = buildKeyboardEventData(event);

      chrome.runtime.sendMessage({
        action: ACTIONS.BROADCAST,
        originWindowId: WINDOW_ID,
        type: MESSAGE_TYPES.KEY_EVENT,
        subType: type,
        keyData,
        xRatio: ratio.x,
        yRatio: ratio.y,
      }).catch(() => { });
    }, true);
  });

  // 4. CAPTURE & BROADCAST SCROLL EVENTS
  const broadcastScroll = rAfThrottle(
    /**
     * @param {Element | Document} target
     */
    (target) => {
      const isDocument = target === document;
      const el = isDocument ? document.documentElement : target;
      const ratio = scrollOffsetToRatio(el);
      const point = isDocument ? { x: 0.5, y: 0.5 } : elementCenterToRatio(el);

      chrome.runtime.sendMessage({
        action: ACTIONS.BROADCAST,
        originWindowId: WINDOW_ID,
        type: MESSAGE_TYPES.SCROLL_EVENT,
        // document/window scroll vs nested overflow container
        isDocument,
        xRatio: ratio.x,
        yRatio: ratio.y,
        // optional: help target nested scrollers
        xPoint: point.x,
        yPoint: point.y,
      }).catch(() => { });
    }
  );

  window.addEventListener("scroll", (event) => {
    if (!event.isTrusted || !state.syncScroll) return;
    broadcastScroll(event.target);
  }, true); // capture: true so nested scroll containers are included

  // 5. LISTEN FOR INCOMING BROADCASTS FROM OTHER WINDOWS
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== ACTIONS.EXECUTE) return;
    if (message.originWindowId === WINDOW_ID) return;

    // Isolate POINTER_MOVE from the heavy UI pulse & logging to save performance
    if (message.type === MESSAGE_TYPES.POINTER_MOVE && state.syncCursor) {
      const point = ratioToPoint(message.xRatio, message.yRatio);

      // Render Ghost Cursor
      ghostCursor.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
      ghostCursor.style.opacity = "1";

      // Fade out after 800ms of inactivity
      clearTimeout(ghostCursorTimeout);
      ghostCursorTimeout = setTimeout(() => {
        ghostCursor.style.opacity = "0";
      }, 800);
      return;
    }

    updateStatus(badge);

    console.log(`%c[REMOTE EVENT RECEIVED]%c ${message.type} -> ${message.subType || ""}`, "color: #00ffff; font-weight: bold;", "color: default;", message);

    // A. EXECUTE POINTER / CLICK
    if ((message.type === MESSAGE_TYPES.POINTER_EVENT) && state.syncMouse) {
      pulseUI(panel);

      const point = ratioToPoint(message.xRatio, message.yRatio);
      const element = elementAt(point.x, point.y, document.body);

      console.log(`[SYNC EXECUTE] ${message.subType || "click"} at (${Math.round(point.x)}px, ${Math.round(point.y)}px) on:`, element);
      dispatchSyntheticPointerEvent(element, point.x, point.y, message.subType);
    }
    // B. EXECUTE KEYBOARD EVENT
    else if (message.type === MESSAGE_TYPES.KEY_EVENT && state.syncKeyboard) {
      pulseUI(panel);

      if (message.subType === "keydown" || !syncedKeyTarget) {
        const point = ratioToPoint(message.xRatio, message.yRatio);
        syncedKeyTarget = elementAt(point.x, point.y, document.activeElement ?? document.body);

        if (typeof syncedKeyTarget.focus === "function") {
          syncedKeyTarget.focus();
        }
      }

      if (syncedKeyTarget) {
        console.log(`[SYNC EXECUTE] ${message.subType} [${message.keyData.code}] on:`, syncedKeyTarget);
        dispatchSyntheticKeyboardEvent(syncedKeyTarget, message.subType, message.keyData);
      }

      if (message.subType === "keyup") {
        syncedKeyTarget = null;
      }
    }
    // C. EXECUTE SCROLL EVENT
    else if (message.type === MESSAGE_TYPES.SCROLL_EVENT && state.syncScroll) {
      pulseUI(panel);

      let target;
      if (message.isDocument) {
        target = document.documentElement;
      } else {
        const point = ratioToPoint(message.xPoint, message.yPoint);
        target = elementAt(point.x, point.y);
        target = findScrollableAncestor(target);
      }

      const offset = ratioToScrollOffset(target, message.xRatio, message.yRatio);

      target.scrollTo({
        top: offset.top,
        left: offset.left,
        behavior: "auto", // instant; "smooth" desyncs mid-scroll
      });
    }
  });

  // Helpers
  function updateStatus(badge) {
    // Flash badge blue when receiving remote event
    badge.style.setProperty("background", "cyan");
    badge.style.setProperty("color", "#000");
    // Reset styles after 200ms
    setTimeout(() => {
      badge.style.removeProperty("background");
      badge.style.removeProperty("color");
    }, 200);
  }

  function createControlPanel() {
    // Initialize variables
    let panel = null,
      mouseToggle = null,
      scrollToggle = null,
      keyToggle = null,
      cursorToggle = null,
      badge = null,
      grabHandle = null,
      dragging = false,
      panelBounds = null,
      grabHandleBounds = null,
      grabOffsetTop = 0,
      grabOffsetLeft = 0,
      grabInsetTop = 0,
      grabInsetLeft = 0;

    const keys = Object.keys(config);
    // 1. INITIALIZE & LISTEN TO PERSISTED STORAGE SETTINGS
    chrome.storage.local.get(keys, (res) => {
      keys.forEach((key) => {
        config[key] = res[key] ?? DEFAULT_CONFIG[key];
      });

      updateUIControls();
    });

    chrome.storage.onChanged.addListener((changes) => {
      keys.forEach((key) => {
        const change = changes[key];
        if (!change) return;
        config[key] = change.newValue;
      });

      updateUIControls();
    });

    // 2. BUILD IN-PAGE CONTROL PANEL
    panel = document.createElement("div");
    panel.id = "mirror-sync-panel";

    panel.innerHTML = `
      <style>
        #mirror-sync-panel {
          position: fixed;
          top: 10px;
          right: 10px;
          z-index: 999999;
          background: rgba(20, 20, 25, 0.9);
          backdrop-filter: blur(6px);
          color: #fff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 12px;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          display: flex;
          flex-direction: column;
          gap: 6px;
          user-select: none;
          min-width: 150px;
        }
        
        #mirror-sync-panel .drag-handle {
          display: block;
          position: absolute;
          top: 0;
          left: 0;
          transform: translate(-50%, -50%);
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #fff;
          cursor: grab;
        }
        #mirror-sync-panel .header {
          padding-bottom: 6px;
          border-bottom: 1px solid #262626;
        }
        #mirror-sync-panel .badge {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #008000;
          color: #fff;
          padding: 4px 8px;
          font: 12px bold sans-serif;
          border-radius: 4px;
          opacity: 0.8;
        }
        #mirror-sync-panel .badge small {
          font-size: 10px;
        }
        #mirror-sync-panel .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        #mirror-sync-panel label {
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
        }
          
        #mirror-sync-panel input[type="checkbox"] {
          cursor: pointer;
          accent-color: #4cd964;
        }

        #mirror-sync-panel .toggle-switch {
          position: relative;
          display: inline-block;
          width: 32px;
          height: 18px;
          pointer-events: all;
        }
        #mirror-sync-panel .toggle-switch input[type="checkbox"] {
          appearance: none;
          display: none;
          opacity: 0;
          width: 0;
          height: 0;
        }
        #mirror-sync-panel .toggle-switch-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          border-radius: 18px;
          -webkit-transition: .4s;
          transition: .4s;
        }

        #mirror-sync-panel .toggle-switch-slider::before {
          position: absolute;
          content: "";
          height: 14px;
          width: 14px;
          top: 2px;
          left: 3px;
          background-color: #fff;
          border-radius: 50%;
          -webkit-transition: .4s;
          transition: .4s;
        }

        #mirror-sync-panel .toggle-switch input[type="checkbox"]:checked + .toggle-switch-slider {
          background-color: #2196F3;
        }

        #mirror-sync-panel .toggle-switch input[type="checkbox"]:focus + .toggle-switch-slider {
          box-shadow: 0 0 1px #2196F3;
        }

        #mirror-sync-panel .toggle-switch input[type="checkbox"]:checked + .toggle-switch-slider::before {
          -webkit-transform: translateX(12px);
          -ms-transform: translateX(12px);
          transform: translateX(12px);
        }

        #mirror-sync-panel.receiving {
          border-color: #00ffff;
          box-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
        }
      </style>

      <div class="drag-handle"></div>

      <div class="header">
        <div class="badge" id="sync-extension-badge">
          <span>SYNC ACTIVE</span>
          <small>[${WINDOW_ID.slice(0, 4)}]</small>
        </div>
      </div>

      <div class="row">
        <span>Ghost Cursor</span>
        <label class="toggle-switch">
          <input type="checkbox" id="sync-cursor-toggle_${WINDOW_ID}" ${config.syncCursor ? "checked" : ""}>
          <span class="toggle-switch-slider"></span>
        </label>
      </div>

      <div class="row">
        <span>Mouse Events</span>
        <label class="toggle-switch">
          <input type="checkbox" id="sync-mouse-toggle_${WINDOW_ID}" ${config.syncMouse ? "checked" : ""}>
          <span class="toggle-switch-slider"></span>
        </label>
      </div>
      <div class="row">
        <span>Scroll Events</span>
        <label class="toggle-switch">
          <input type="checkbox" id="sync-scroll-toggle_${WINDOW_ID}" ${config.syncScroll ? "checked" : ""}>
          <span class="toggle-switch-slider"></span>
        </label>
      </div>
      <div class="row">
        <span>Keyboard Events</span>
        <label class="toggle-switch">
          <input type="checkbox" id="sync-key-toggle_${WINDOW_ID}" ${config.syncKeyboard ? "checked" : ""}>
          <span class="toggle-switch-slider"></span>
        </label>
      </div>
    `;

    // Bind checkbox handlers to update chrome.storage
    mouseToggle = panel.querySelector("[id^=\"sync-mouse-toggle\"]");
    scrollToggle = panel.querySelector("[id^=\"sync-scroll-toggle\"]");
    keyToggle = panel.querySelector("[id^=\"sync-key-toggle\"]");
    cursorToggle = panel.querySelector("[id^=\"sync-cursor-toggle\"]");

    badge = panel.querySelector("#sync-extension-badge");

    grabHandle = panel.querySelector(".drag-handle");

    // Attach to DOM tree and initialize
    if (document.body) {
      document.body.append(panel);

      init();
    } else window.addEventListener("DOMContentLoaded", () => {
      document.body.append(panel);

      init();
    });

    function init() {
      // Handle localStorage changes
      mouseToggle.addEventListener("change", (ev) => {
        chrome.storage.local.set({ syncMouse: ev.target.checked });
      });
      scrollToggle.addEventListener("change", (ev) => {
        chrome.storage.local.set({ syncScroll: ev.target.checked });
      });
      keyToggle.addEventListener("change", (ev) => {
        chrome.storage.local.set({ syncKeyboard: ev.target.checked });
      });
      cursorToggle.addEventListener("change", (ev) => chrome.storage.local.set({ syncCursor: ev.target.checked }));

      // Init dragging logic
      grabHandle.addEventListener("pointerdown", (ev) => {
        if (dragging || ev.target !== grabHandle) return;

        dragging = true;

        if (ev.pointerId) panel.setPointerCapture(ev.pointerId);

        grabHandle.style.setProperty("cursor", "grabbing");

        // get bounding rects
        panelBounds = panel.getBoundingClientRect();
        grabHandleBounds = grabHandle.getBoundingClientRect();

        // click point within the handle
        grabOffsetTop = ev.clientY - grabHandleBounds.top;
        grabOffsetLeft = ev.clientX - grabHandleBounds.left;

        // handle origin relative to panel origin (includes translate(-50%, -50%))
        grabInsetTop = grabHandleBounds.top - panelBounds.top;
        grabInsetLeft = grabHandleBounds.left - panelBounds.left;

        window.addEventListener("pointerup", dragEndedHandler);
        window.addEventListener("pointercancel", dragEndedHandler);
        window.addEventListener("pointermove", draggingHandler);
      });
    };

    // Handle updating UI state
    function updateUIControls() {
      if (mouseToggle) mouseToggle.checked = config.syncMouse;
      if (keyToggle) keyToggle.checked = config.syncKeyboard;
      if (scrollToggle) scrollToggle.checked = config.syncScroll;
      if (cursorToggle) cursorToggle.checked = config.syncCursor;
    }

    function draggingHandler(ev) {
      if (!dragging) return;

      let offsetX = ev.clientX - grabOffsetLeft;
      let offsetY = ev.clientY - grabOffsetTop;

      let top = offsetY - grabInsetTop;
      let left = offsetX - grabInsetLeft;

      // handle top/left >= 0  →  panel >= -inset
      const minTop = -grabInsetTop;   // ≈ 5
      const minLeft = -grabInsetLeft; // ≈ 5

      const maxTop = window.innerHeight - panelBounds.height;
      const maxLeft = window.innerWidth - panelBounds.width;

      top = Math.min(Math.max(top, minTop), maxTop);
      left = Math.min(Math.max(left, minLeft), maxLeft);

      panel.style.setProperty("top", `${top}px`);
      panel.style.setProperty("left", `${left}px`);
      panel.style.setProperty("right", "auto"); // By default "right" is used in CSS, must override with "auto"
    };

    function dragEndedHandler(ev) {
      if (!dragging) return;

      dragging = false;

      grabHandle.style.removeProperty("cursor");

      window.removeEventListener("pointerup", dragEndedHandler);
      window.removeEventListener("pointercancel", dragEndedHandler);
      window.removeEventListener("pointermove", draggingHandler);
    };

    return { panel, badge, state: config, update: updateUIControls };
  }

  function pulseUI(panel) {
    panel.classList.add("receiving");

    setTimeout(() => panel.classList.remove("receiving"), 150);
  }

  // Generate the Ghost Cursor DOM Element
  function createGhostCursor() {
    const cursor = document.createElement("div");
    cursor.id = "mirror-sync-ghost-cursor";
    cursor.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 14px;
      height: 14px;
      background-color: rgba(0, 255, 255, 0.4);
      border: 2px solid #00ffff;
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(0, 255, 255, 0.8);
      pointer-events: none;
      z-index: 2147483647; 
      transform: translate(-50%, -50%); 
      opacity: 0; 
      transition: opacity 0.2s ease-out;
      will-change: transform;
    `;

    if (document.body) {
      document.body.append(cursor);
    } else {
      window.addEventListener("DOMContentLoaded", () => document.body.append(cursor));
    }
    return cursor;
  }
}