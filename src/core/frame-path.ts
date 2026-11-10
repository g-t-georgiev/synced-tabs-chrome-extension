/**
 * Position of the current frame in its tab's frame tree, as the chain of child
 * indices from the top window: `""` for the top frame, `"1"` for the second
 * child iframe, `"1/0"` for that iframe's first child, and so on.
 *
 * Identical pages produce identical paths in every tab, so the path pairs a
 * frame with its counterpart in another tab. `window.frames` and WindowProxy
 * identity are readable across origins, so this works for cross-origin parents.
 * Computed on demand because iframes can be added or removed at runtime.
 */
export function getFramePath(): string {
  const indices: number[] = [];
  let current: Window = window;

  while (current !== current.parent) {
    const parent = current.parent;
    let index = -1;

    for (let i = 0; i < parent.frames.length; i++) {
      if (parent.frames[i] === current) {
        index = i;
        break;
      }
    }

    indices.unshift(index);
    current = parent;
  }

  return indices.join("/");
}
