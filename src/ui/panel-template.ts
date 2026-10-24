import type { StateConfig, StateStore } from "../shared/types";

export function createPanelUICSS() {
  return `
  <style>
    :host {
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
    :host(.receiving) {
      border-color: #00ffff;
      box-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
    }

    .drag-handle {
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
      z-index: 1;
    }

    .header {
      padding-bottom: 2px;
      border-bottom: 1px solid #262626;
    }

    .badge {
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
    .badge small {
      font-size: 10px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      font-size: 12px;
    }
    .row:last-child {
      padding-bottom: 4px;
    }

    label {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    input[type="checkbox"] {
      cursor: pointer;
      accent-color: #4cd964;
    }

    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 32px;
      height: 18px;
      pointer-events: all;
    }
    .toggle-switch input[type="checkbox"] {
      appearance: none;
      display: none;
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-switch-slider {
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

    .toggle-switch-slider::before {
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

    .toggle-switch input[type="checkbox"]:checked + .toggle-switch-slider {
      background-color: #2196F3;
    }

    .toggle-switch input[type="checkbox"]:focus + .toggle-switch-slider {
      box-shadow: 0 0 1px #2196F3;
    }

    .toggle-switch input[type="checkbox"]:checked + .toggle-switch-slider::before {
      -webkit-transform: translateX(12px);
      -ms-transform: translateX(12px);
      transform: translateX(12px);
    }
  </style>`;
}

export function createPanelUIHTML({ windowId, config }: { windowId: string, config: StateStore<StateConfig>}) {
  return `
  <div class="drag-handle"></div>

  <div class="header">
    <div class="badge" id="sync-extension-badge">
      <span>SYNC ACTIVE</span>
      <small>[${windowId.slice(0, 4)}]</small>
    </div>
  </div>

  <div class="row">
    <span>Ghost Cursor</span>
    <label class="toggle-switch">
      <input type="checkbox" id="sync-cursor-toggle_${windowId}" ${config.state.syncCursor ? "checked" : ""}>
      <span class="toggle-switch-slider"></span>
    </label>
  </div>

  <div class="row">
    <span>Mouse Events</span>
    <label class="toggle-switch">
      <input type="checkbox" id="sync-mouse-toggle_${windowId}" ${config.state.syncMouse ? "checked" : ""}>
      <span class="toggle-switch-slider"></span>
    </label>
  </div>
  <div class="row">
    <span>Scroll Events</span>
    <label class="toggle-switch">
      <input type="checkbox" id="sync-scroll-toggle_${windowId}" ${config.state.syncScroll ? "checked" : ""}>
      <span class="toggle-switch-slider"></span>
    </label>
  </div>
  <div class="row">
    <span>Keyboard Events</span>
    <label class="toggle-switch">
      <input type="checkbox" id="sync-key-toggle_${windowId}" ${config.state.syncKeyboard ? "checked" : ""}>
      <span class="toggle-switch-slider"></span>
    </label>
  </div>`;
}