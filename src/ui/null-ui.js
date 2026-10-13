/** 
 * Create "dummy" interface for null UI
 * @returns {import("../constants").UIController}
 */
export function createNullUi() {
  return {
    flash() {/* Dummy method */},
    pulse() {/* Dummy method */}
  };
}