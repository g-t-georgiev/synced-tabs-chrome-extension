import { main } from "./main";

declare global {
  interface Window {
    __MIRROR_SYNC_INITIALIZED__?: boolean;
  }
}

if (!window.__MIRROR_SYNC_INITIALIZED__) {
  window.__MIRROR_SYNC_INITIALIZED__ = true;
  main();
}