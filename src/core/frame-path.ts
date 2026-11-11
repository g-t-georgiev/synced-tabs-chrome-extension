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

/**
 * Splits a child frame's path into its parent's path and its index among the parent's
 * frames: `"1/0"` → `{ parent: "1", index: 0 }`, `"2"` → `{ parent: "", index: 2 }`.
 * Returns `null` for the top frame (`""`) or an unknown position.
 */
export function splitFramePath(path: string): { parent: string; index: number } | null {
  if (!path) return null;
  const cut = path.lastIndexOf("/");
  const index = Number(path.slice(cut + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { parent: cut === -1 ? "" : path.slice(0, cut), index };
}
