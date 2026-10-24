import type { UIController } from "../shared/types";

/** Creates "dummy" interface for null UI. */
export function createNullUi(): UIController {
  return {
    flash() {/* Dummy method */},
    pulse() {/* Dummy method */}
  };
}