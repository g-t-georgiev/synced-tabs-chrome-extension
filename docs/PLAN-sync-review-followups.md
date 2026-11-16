# Plan: sync review follow-ups

Branch: `sync-review-followups` (from `main` @ `8bc224c`). One commit per step, each with
its own tests; `vp check`, `vp test` and the build must pass before each commit.

Open questions are marked **❓** — answer them inline or in chat.

---

## Step 1 — Scroll: ancestor walk can hang; wrong root scroller

**Issue.** `findScrollableAncestor` only advances when `parentElement` exists. A hit on
`<html>` (body margin, or a receiver whose layout differs) has no parent and is not
scrollable by default, so the loop never ends and the tab freezes. The walk also stops at
`<body>` and scrolls it, which does not move the page in standards mode.

**Fix.** Iterate with a `for` loop that always advances, crosses shadow roots, and falls
back to `document.scrollingElement`.

`src/dom/element-resolver.ts`

```ts
function parentOf(el: Element): Element | null {
  return el.parentElement ?? (el.getRootNode() as ShadowRoot).host ?? null;
}

function isScrollable(el: HTMLElement) {
  const style = getComputedStyle(el);
  const y = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
  const x = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
  return x || y;
}

export function findScrollableAncestor(start?: Element | null): HTMLElement {
  const root = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  for (let el = start ?? null; el && el !== document.body && el !== root; el = parentOf(el)) {
    if (el instanceof HTMLElement && isScrollable(el)) return el;
  }
  return root;
}
```

Tests (`element-resolver.test.ts`): start at `<html>` returns (no hang); start inside a
scrollable div returns the div; start in non-scrollable content returns the root scroller.

---

## Step 2 — Hit-testing: SVG, shadow DOM, and our own UI

**Issue.** `elementAt` drops anything that is not an `HTMLElement`, so a click on an SVG
icon falls back to `<body>`. `elementFromPoint` stops at shadow hosts. A page click can also
land on the receiver's own panel when it sits elsewhere than the sender's.

**Fix.** One resolver used by every feature:

- skip our own UI hosts (marked `data-mirror-sync-ui`) so a page click reaches the page
  element underneath the receiver's panel;
- descend into open shadow roots;
- return `Element` (an SVG `rect` is a valid dispatch target — the event bubbles to the
  owning `<button>`, exactly like a native click).

`src/dom/element-resolver.ts`

```ts
export const OWN_UI_ATTR = "data-mirror-sync-ui";

export function isOwnUi(node: EventTarget | null) {
  return node instanceof Element && node.closest(`[${OWN_UI_ATTR}]`) !== null;
}

/** Deepest page element at the point, ignoring the extension's own UI. */
export function elementAt(x: number, y: number): Element | null {
  let el = document.elementsFromPoint(x, y).find((e) => !isOwnUi(e)) ?? null;
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}
```

`src/ui/panel.ts`, `src/ui/cursor.ts` — `host.setAttribute(OWN_UI_ATTR, "")`.

`src/features/pointer-sync.ts`, `keyboard-sync.ts` — on the sender, ignore events from our
own UI (the panel gets its own handling in step 8):

```ts
if (!event.isTrusted || event.composedPath().some(isOwnUi)) return;
```

Callers that need an `HTMLElement` (focus, keyboard target) use a small
`closestHTMLElement(el)` helper.

---

## Step 3 — Background worker: exact host match, tab cache, no per-frame work

**Issue.** `tab.url.includes(host)` matches `https://example.com/?next=localhost`, and the
worker then injects the content script there. Every cursor frame triggers `tabs.query`, a
log line per tab, and — for tabs that reject messages — `executeScript` every frame.

**Fix.** Keep port-agnostic matching (your `localhost:8080` / `:8081` /
CI host mix keeps working), but compare the parsed hostname exactly.
Cache target tabs, inject at most once per page load, and stop logging per event.

`src/shared/constants.ts`

```ts
export const TARGET_HOSTNAMES = new Set(["localhost", "127.0.0.1", "ci.example.test"]);
```

_Later superseded: the hosts now come from `VITE_TARGET_MATCHES` in `.env` (see "Also done"
below), so no real host is committed._

`src/background/targets.ts` (new, pure → unit-tested)

```ts
export function isTargetUrl(url?: string) {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && TARGET_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}
```

`src/background/index.ts` (sketch)

```ts
const targets = new Map<number, { unreachable: boolean }>(); // tabId -> state
const ready = chrome.tabs
  .query({})
  .then((tabs) =>
    tabs.forEach((t) => t.id && isTargetUrl(t.url) && targets.set(t.id, { unreachable: false })),
  );

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && info.status !== "loading") return;
  // A new page load resets the "unreachable" back-off.
  isTargetUrl(tab.url) ? targets.set(tabId, { unreachable: false }) : targets.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => targets.delete(tabId));

async function deliver(tabId: number, message: Message, options, allowInject: boolean) {
  const state = targets.get(tabId)!;
  try {
    return await chrome.tabs.sendMessage(tabId, message, options);
  } catch {
    if (!allowInject || state.unreachable) return UNREACHABLE;
    state.unreachable = true; // one attempt per page load
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      });
      state.unreachable = false;
      return await chrome.tabs.sendMessage(tabId, message, options);
    } catch (err) {
      console.warn(`[BACKGROUND] Tab ${tabId} unreachable`, err); // logged once per page load
      return UNREACHABLE;
    }
  }
}
```

- `allowInject` is `false` for `POINTER_MOVE` (cursor frames never inject).
- Injection uses `allFrames: true` so iframe-targeted messages have a receiver too.
- `public/manifest.json`: add `http://127.0.0.1/*` to `matches` so manifest and worker agree.

---

## Step 4 — Synthetic pointer events closer to the real thing

**Issue.** No `button` / `buttons` / `pointerType` / `pointerId` / `isPrimary` / `detail`;
no compatibility `mousedown` / `mouseup` (libraries listening to mouse events never react);
`focus()` runs on every event, on whatever element was hit.

**Fix.**

`src/features/pointer-sync.ts` — the sender also sends `button` and `buttons`.

`src/dom/synthetic-events.ts`

```ts
const COMPAT = { pointerdown: "mousedown", pointerup: "mouseup" } as const;
let compatSuppressed = false; // pointerdown.preventDefault() suppresses mouse compat until pointerup

export function dispatchPointer(el: Element, type: string, x: number, y: number, btn: ButtonState) {
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    button: btn.button,
    buttons: btn.buttons,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    detail: type === "click" ? 1 : 0,
  };
  const proceed = el.dispatchEvent(new PointerEvent(type, init));

  if (type === "pointerdown") {
    compatSuppressed = !proceed;
    if (proceed) focusLikeNative(el);
  }
  const compat = COMPAT[type as keyof typeof COMPAT];
  if (compat && !compatSuppressed) el.dispatchEvent(new MouseEvent(compat, init));
  if (type === "pointerup") compatSuppressed = false;
}

function focusLikeNative(el: Element) {
  const target = el.closest<HTMLElement>("button, input, select, textarea, a[href], [tabindex]");
  target?.focus({ preventScroll: true });
}
```

`click` stays a `PointerEvent` (Chrome does the same for native clicks). Drop the
`isPointerEventSupported` / `MouseEvent` fallback — the target is Chrome 120+.

---

## Step 5 — Small correctness fixes

`src/content/main.ts` — start capturing only once stored settings are loaded:

```ts
config.ready.then(() => engine.start());
```

Constraint from step 3: after injecting `content.js`, the worker re-sends the message
immediately, so the **remote listener must still register synchronously**. Only the
capture side waits for `config.ready`; incoming messages arriving before it are applied
with the stored settings once loaded (or dropped if the feature is off).

`src/features/keyboard-sync.ts` — one target per physical key instead of a single shared
slot, so overlapping keys don't steal each other's `keyup`:

```ts
const keyTargets = new Map<string, Element>(); // KeyboardEvent.code -> target
// keydown: resolve + set; keypress/keyup: reuse keyTargets.get(code) ?? resolve; keyup: delete
```

---

## Step 6 — Notification system (new)

**Goal.** One notifier, created once in `main`, usable from any feature or the content
script. Toasts render only in the tab where they are raised (the sender).

Style: semi-transparent black background; **warning** = yellow border + text, **error** =
red border + text. Stacked bottom-right, auto-dismiss, click to dismiss. Same `key` →
refresh the existing toast (with a repeat counter) instead of stacking duplicates.

`src/shared/types.ts`

```ts
export type NoticeLevel = "warning" | "error";
export interface NoticeOptions {
  key?: string;
  durationMs?: number;
}
export interface Notifier {
  warn(text: string, options?: NoticeOptions): void;
  error(text: string, options?: NoticeOptions): void;
}
```

`src/ui/notifications.ts` (new) — shadow-DOM host marked `data-mirror-sync-ui`,
`pointer-events: none` on the container, `auto` on toasts.

```css
.toast {
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid;
  border-radius: 6px;
  padding: 6px 10px;
  font:
    12px/1.4 system-ui,
    sans-serif;
}
.toast.warning {
  border-color: #ffcc00;
  color: #ffcc00;
}
.toast.error {
  border-color: #ff4d4f;
  color: #ff4d4f;
}
```

Child frames: the notifier relays to the top frame (`{ action: NOTIFY }` → background →
`chrome.tabs.sendMessage(sender.tab.id, …, { frameId: 0 })`), so toasts always appear in
the tab's top-level viewport rather than inside a small iframe.

`src/content/main.ts` — `const notifier = window.top === window ? createNotifier() : createRelayNotifier();`
then pass `notifier` to features that need it (same pattern as `logger`).

---

## Step 7 — Delivery reports + viewport-size mismatch (new)

**Issue.** Coordinates travel as viewport ratios. When one tab is narrower or shorter
(DevTools docked, uneven split, resized window), fixed-pixel UI (the React debug panel)
no longer lines up and clicks land on the wrong element.

**Fix.**

1. Every broadcast carries the sender frame's viewport: `viewport: { w, h }`
   (`src/core/messaging.ts`).
2. Receivers compare it with their own. Features whose target is resolved **by point**
   handle a mismatch explicitly:

   | Feature                   | On mismatch                                               |
   | ------------------------- | --------------------------------------------------------- |
   | Pointer (down/up/click)   | **dropped**                                               |
   | Panel drag (step 8)       | dropped                                                   |
   | Keyboard                  | still sent; target = focused element instead of the point |
   | Scroll (document)         | applied (ratio-based, size-independent)                   |
   | Scroll (nested container) | dropped (container found by point)                        |
   | Text fields (step 9)      | dropped (the field must be at the same coordinates)       |
   | Ghost cursor              | applied                                                   |

3. `Feature.apply` returns an `ApplyResult`; the receiving frame answers the message with
   it. The worker collects answers from all tabs and replies to the sender, which turns
   drops into toasts. Only discrete events request a report (never cursor frames).

`src/shared/types.ts`

```ts
export type ApplyResult =
  | { status: "applied" }
  | { status: "dropped"; reason: "viewport-mismatch" | "panel-miss"; viewport?: Viewport };
export interface DeliveryReport {
  results: Array<ApplyResult & { tabId: number }>;
}
```

`src/background/index.ts`

```ts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== ACTIONS.BROADCAST) return;
  fanOut(message, sender).then(sendResponse); // Promise<DeliveryReport>
  return true; // async response
});
```

`src/core/messaging.ts` — only the frame whose `framePath` matches calls `sendResponse`;
other frames return without answering.

`src/core/sync-engine.ts` — on the sender, map a report to one deduplicated toast:

```ts
const dropped = report.results.filter((r) => r.reason === "viewport-mismatch");
if (dropped.length)
  notifier.warn(
    `Size mismatch with ${dropped.length} tab(s): ${dropped[0].viewport.w}×${dropped[0].viewport.h} ` +
      `vs ${innerWidth}×${innerHeight}. Clicks were not mirrored.`,
    { key: "viewport-mismatch" },
  );
```

✅ **Tolerance (decided):** a difference of more than 1px in either dimension is a mismatch.

**As built.** Reports are requested only where a drop can happen: once per press
(pointerdown) and for scrolls of inner containers. `broadcast(payload, { report: "Clicks" })`
names what was mirrored, and the transport turns the report into toasts — a warning per
kind for size mismatches (key `viewport-mismatch:<what>`) and an error when tabs were
unreachable (key `unreachable:<what>`). Messages received before settings load are answered
once applied.

---

## Step 8 — Panel-aware pointer sync (new)

**Behaviour.**

- A click on the panel is **never** forwarded as a page click. In tabs whose panel is not
  at the same spot, it is dropped — it never reaches the page element at those coordinates.
- Pressing the **drag handle** and dragging: panels in the other tabs whose handle is at the
  same spot start following, with the same pixel position (clamped to their own viewport).
  Panels elsewhere stay put; the sender gets a warning toast ("Panel in 1 tab is elsewhere
  and didn't follow").
- A page click that lands on the _receiver's_ panel passes through to the page underneath
  (step 2), because in the sender's tab it hit the page.

✅ **Toggles (decided):** settings stay global. Toggles keep working as today through
`chrome.storage.local`; toggle clicks are not mirrored. The "same element at the same spot"
rule applies to the drag handle only.

`src/ui/panel.ts` — expose what the feature needs:

```ts
export interface PanelController extends UIController {
  hitTest(x: number, y: number): "handle" | "toggle" | "body" | null; // via shadowRoot.elementFromPoint
  getPosition(): { left: number; top: number };
  setPosition(left: number, top: number): void; // reuses the existing clamping
  onDrag(
    listener: (phase: "start" | "move" | "end", pos: Position, point: Point) => void,
  ): () => void;
}
```

`src/features/panel-sync.ts` (new, under the `syncMouse` toggle)

```ts
capture() {
  return panel.onDrag((phase, pos, point) =>
    transport.broadcast({ type: MESSAGE_TYPES.PANEL_DRAG, phase, ...pos, xPoint: point.x, yPoint: point.y },
      { report: phase === "start" }),
  );
},
apply(message) {
  if (message.phase === "start") {
    following = viewportMatches(message) && panel.hitTest(message.xPoint, message.yPoint) === "handle";
    return following ? APPLIED : { status: "dropped", reason: "panel-miss" };
  }
  if (!following) return;
  panel.setPosition(message.left, message.top);
  if (message.phase === "end") following = false;
},
```

Drag messages are rAF-throttled like cursor moves. Child frames use the null UI, so
`hitTest` returns `null` there and panel messages are ignored.

---

## Step 9 — Text field sync (new feature, own toggle)

**Issue.** Synthetic key events never insert text and the receiver can't read your
clipboard, so pasting a seed into the debug panel only works in the tab you pasted into.

**Fix.** Mirror the field's _value_, not keystrokes. New config key `syncText` with its own
panel toggle ("Text Fields").

- **Sender:** listen for trusted `input` events on `<input>` (text-like types),
  `<textarea>` and `<select>`; send the full value, the field's rect in px, and its
  fingerprint. Password fields are never sent.
- **Receiver — strict match, otherwise drop.** The value is applied only if _all_ of these
  hold:
  1. viewports match (step 7);
  2. `elementAt` at the field's centre returns a field (not something covering it);
  3. that field's rect equals the sender's within 1px (left, top, width, height);
  4. the fingerprint is identical: tag, `type`, `id`, `name`, `placeholder`, `aria-label`,
     and `class` list (order-independent). Attributes absent on both sides count as equal.

  Any miss → nothing is written, and the sender gets a warning toast
  ("Text not mirrored to 1 tab: field differs"). No selector fallback — a field that isn't
  at the same place with the same identity is treated as a different field.

- Set the value through the native setter so React's `onChange` fires, then dispatch
  `input` and `change` (see Tweakpane note below).
- No echo: setting `value` from script fires no trusted `input` event, and the sender
  ignores untrusted ones.

**How it fits with keyboard and mouse sync.** Each stays a separate toggle; together they
cover a field end-to-end:

- _Mouse_ places focus: the mirrored pointerdown focuses the same field (step 4).
- _Text_ carries the content: typing, paste, cut, delete, autofill, undo.
- _Keyboard_ carries the keys themselves: page shortcuts and handlers (e.g. the spin key)
  still fire. A synthetic key never inserts text, so with both on, text is not doubled.
- If keyboard sync is off, text sync still works on its own; if text sync is off,
  keyboard sync behaves exactly as today.

✅ **Classes (decided): strict.** The debug panel is built with Tweakpane, whose class
names are stable (`tp-txtv_i`, …) with no build hashes. Tweakpane fields usually have no
`id` / `name`, so in practice classes + rect identify the field.

**Tweakpane specifics.** Tweakpane commits a text field's value on the `change` event, not
on `input`. The sender listens for trusted `input` _and_ `change` events, and the receiver
fires the same event the sender's field fired: `input` while editing (React's `onChange`),
`change` on commit (Enter/blur). So Tweakpane in the other tab commits when yours does, not
on every keystroke. Verified in Chrome with React 18 and Tweakpane 3.1.10.

`src/features/text-sync.ts` (new)

```ts
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); // bypasses React's value tracker
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true })); // Tweakpane commits on change
}
```

`src/dom/field-fingerprint.ts` (new) — `fingerprint(el)`, `sameField(a, b)` and
`sameRect(a, b, 1)`; unit-tested.

```ts
export function fingerprint(el: Element): FieldFingerprint {
  return {
    tag: el.tagName,
    type: el.getAttribute("type"),
    id: el.id || null,
    name: el.getAttribute("name"),
    placeholder: el.getAttribute("placeholder"),
    ariaLabel: el.getAttribute("aria-label"),
    classes: [...el.classList].sort(),
  };
}
```

`src/shared/constants.ts` — `DEFAULT_CONFIG.syncText`, `MESSAGE_TYPES.TEXT_INPUT`.
`src/ui/panel-template.ts` — new toggle row. `src/content/main.ts` — register the feature.

✅ **Default (decided):** `syncText: true`.

---

## Step 10 — Ghost cursor only in the top frame (new)

**Issue.** `createCursor()` runs in every frame (`all_frames: true`), so each iframe, and
each iframe inside it, has its own ghost cursor. A cursor move inside an iframe is drawn
by that iframe's own cursor, clipped to the iframe, and the top-level cursor stays wherever
it last was.

**Fix.** Like the panel and the toasts, only the top frame creates the cursor. A receiving
child frame converts the mirrored point (relative to its own viewport) into top-viewport
coordinates and hands it to the top frame.

The conversion needs each iframe's position inside its parent. A child frame can't read
that across origins, but its parent can: the parent finds the `<iframe>` whose
`contentWindow` is `window.frames[i]` (WindowProxy identity works cross-origin) and adds its
content-box offset (`getBoundingClientRect()` + border + padding). So the point climbs the
frame tree one level at a time, each parent adding its iframe's offset, until it reaches the
top frame, which moves the cursor. Child frames use a null cursor.

How the point climbs — ✅ **decided: A, through the extension** (done in `d3335cc`):

- **A (recommended): through the extension.** The child sends
  `{ action: CURSOR_RELAY, framePath, x, y }`; the worker forwards it to the same tab; the
  parent frame (matched by `framePath` minus its last index) adds the offset and repeats.
  Invisible to page scripts; one extra worker round trip per nesting level (~1–3 ms each).
- **B: `window.parent.postMessage`.** Faster, but page scripts see these messages too, and
  apps that use `postMessage` for their own protocols can trip over unknown messages.

Cursor moves are already rAF-throttled, so either path costs at most one relay per frame
per nesting level.

---

# Follow-ups from the first real-tab test

Findings from testing steps 1–10 in Chrome (two monitors, split view):

- Delivery reports and toasts work: size-mismatch warnings appear for clicks, scrolls and
  pastes.
- Two windows on monitors with different display scaling (or zoom) have different CSS
  viewport sizes but the same aspect ratio. The game scales its whole layout with the
  window, so ratio-mapped clicks would land right, but the 1px rule drops them.
- One unexplained error from Tweakpane while pasting into a mirrored field. Not reproduced
  yet.
- Receiving windows mirror edits but show no focus ring, caret or selection: Chrome paints
  those only in the window that has OS focus.

Order: 11 → 12 → 13 → 14, then 15 → 16 → 17 (moved here from "Not doing"). Each step is
one commit with its own tests, like steps 1–10.

---

## Step 11 — Mirror the real `InputEvent`, not a plain `Event` ✅ done (`b033ca9`)

**Issue.** The receiver fires `new Event("input")`. A real edit fires an `InputEvent` with
`inputType` (`insertText`, `insertFromPaste`, `deleteContentBackward`, …) and `data`. Page
code that reads those gets `undefined`, which is a likely cause of the Tweakpane error.

**Fix.** The sender sends the original `inputType` and `data`; the receiver fires a real
`InputEvent` with them. Real `input` events are also `composed`, so ours are too. `change`
stays a plain `Event`, as in browsers.

`src/features/text-sync.ts`

```ts
// sender
const { inputType, data } = event instanceof InputEvent ? event : { inputType: "", data: null };
transport.broadcast({ ...payload, inputType, data }, { report: "Text edits" });

// receiver
const event =
  message.subType === "change"
    ? new Event("change", { bubbles: true })
    : new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: message.inputType ?? "insertText",
        data: message.data ?? null,
      });
field.dispatchEvent(event);
```

`src/shared/types.ts`: add `inputType?: string; data?: string | null` to the payload
(optional, for messages from older builds).

Tests: the receiver fires an `InputEvent` carrying the sender's `inputType` / `data`, with
a fallback to `insertText` for older messages; `change` stays a plain `Event`.

❓ **`beforeinput` too?** Browsers fire a cancelable `beforeinput` before changing the value.
Firing it as well (and not writing the value if the page cancels it) is more faithful, for
example for fields that reject characters. Recommended only if the Tweakpane error persists
after this step.

---

## Step 12 — Ghost focus ring ✅ done (`490a887`, confirmed in real tabs)

**Issue.** Only the window with OS focus draws the focus ring, so in the other windows you
can't see which field is being mirrored.

**Fix.** Like the ghost cursor, the extension draws its own cue. While a value field is
focused in the sending tab, the receiving tabs draw a cyan outline over the matching field
(same match as text sync). Part of the "Text Fields" toggle; no delivery report (edits
already report).

- **Sender:** trusted `focusin` / `focusout` on a value field →
  `TEXT_FOCUS { state: "focus" | "blur", rect, fingerprint }`.
- **Receiver:** find the matching field. On `focus`, outline it; on `blur`, a local focus,
  or the field leaving the page, remove the outline.
- **Outline:** an own-UI host (`data-mirror-sync-ui`, `pointer-events: none`) in the field's
  own frame, positioned over the field's box and kept in place on scroll and resize (rAF
  while shown). Same cyan as the ghost cursor: `2px solid #00ffff`, soft glow.

Files: `src/ui/field-highlight.ts` (new: `show(field)`, `hide()`, follows the field),
`src/features/text-focus.ts` (new) or part of `text-sync.ts`, `src/shared/constants.ts`
(`MESSAGE_TYPES.TEXT_FOCUS`), `src/content/main.ts`.

Tests: outline shown for a matching field, not for a mismatch; hidden on blur and on local
focus; host marked as own UI; position follows the field.

---

## Step 13 — Match by element, not window size, when sizes differ ✅ done (`2ea378b`, confirmed in real tabs)

**Issue.** Windows on screens with different display scaling (or zoom) have different CSS
viewport sizes. When the page scales its layout with the window (the game), positions
mapped by ratio land on the right element, but the 1px rule drops them. The rule must stay
for fixed-pixel UI (Tweakpane keeps its pixel size, so a ratio-mapped point lands
elsewhere).

**Fix.** When sizes match, nothing changes. When they differ, trust a position only if the
element there is the same element:

1. The sender also sends an **anchor**: the identity of the target element plus two
   ancestors, and where inside the target the point is, as fractions of its box
   (`rx = (clientX - rect.left) / rect.width`).
2. The receiver maps the point by ratio, finds the element there, and compares identities.
3. **Same element:** apply at the same fractions inside the receiver's element. For the game
   canvas this is exact, even if the game letterboxes differently.
4. **Different element:** drop with the size-mismatch toast, as today.

Identity is the fingerprint text sync already uses (tag, type, id, name, placeholder,
aria-label, classes). Including two ancestors stops a bare `<div>` or `<canvas>` from
matching an unrelated one.

`src/dom/element-anchor.ts` (new)

```ts
export interface ElementAnchor {
  /** Fingerprints of the target and up to two ancestors, innermost first. */
  chain: FieldFingerprint[];
  /** Point inside the target's box, as fractions of its size. */
  rx: number;
  ry: number;
}

export function anchorAt(target: Element, x: number, y: number): ElementAnchor;
/** The point to use in this frame, or null when the element there isn't the same one. */
export function resolveAnchor(
  anchor: ElementAnchor,
  approx: { x: number; y: number },
): { element: Element; x: number; y: number } | null;
```

Where it applies:

| Feature              | With different sizes                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| Clicks               | applied when the anchor matches, else dropped (today: always dropped)                 |
| Text fields          | same identity, and box equal as a fraction of the viewport (within 1px after scaling) |
| Scroll inside panels | applied when the scroll container's identity matches                                  |
| Keyboard             | unchanged: keys go to the focused element                                             |
| Panel drag           | unchanged: dropped (the panel is fixed-pixel UI)                                      |

The toast wording changes to say why: "…window size differs and the element there doesn't
match."

Files: `src/dom/element-anchor.ts` (new), `src/dom/field-fingerprint.ts` (identity for any
element), `src/features/pointer-sync.ts`, `text-sync.ts`, `scroll-sync.ts`,
`src/core/delivery-report.ts`.

Rejected alternative: treat equal aspect ratios (±1%) as matching. Simpler, but it would let
clicks through on fixed-pixel UI that doesn't line up.

**Tested in real tabs:** canvas clicks land on the same spot with letterboxing, and opening
the debug panel works across monitors. Tweakpane text fields show the mismatch toast, as
intended. Found: clicks on an open Tweakpane panel can land on a neighbouring button or
toggle → step 13b.

---

## Step 13b — Identity check for every click: siblings and box ✅ done (`8c7a6b6`, confirmed in real tabs)

**Issue.** Tweakpane builds every row from identical markup: all buttons are the same
`<button class="tp-btnv_b">` inside the same wrappers, and the same goes for toggles. A click
mapped onto a neighbouring row passes the identity check of step 13 (element + two
ancestors) and fires on the wrong control. And with same-size windows, clicks aren't
checked at all, so a layout difference between branches (local vs CI) clicks whatever sits
at that spot.

**Fix.** Make the anchor check strict enough to tell neighbours apart, and use it for every
click, at any window size:

1. **Sibling position in the identity.** Each level of the chain (the element and its two
   ancestors) also records its index among siblings with the same tag (`nth-of-type`).
   Identical rows then differ. If a branch inserts an item before it, the click is dropped:
   the safe direction.
2. **Box check, like text fields but tolerant.** The element found must have the sender's
   box, scaled by the window ratio when sizes differ, within **max(4px, 10% of the element's
   size)** per dimension. Fixed-pixel UI on a scaled screen fails (Tweakpane); a
   proportionally scaled canvas passes; hover or press effects like `transform:
   scale(1.05)` in the sending tab (hover isn't mirrored) don't cause false drops.
3. **Every click is checked**, also when sizes match. Messages from older builds without an
   anchor keep today's behaviour.

Drops when sizes match get their own reason and toast: "Clicks were not mirrored to 1 tab:
the element there doesn't match." With different sizes, the existing size-mismatch toast
stays.

`src/dom/element-anchor.ts`

```ts
interface AnchorIdentity extends FieldFingerprint {
  /** Index among siblings with the same tag. */
  index: number;
}

export interface ElementAnchor {
  chain: AnchorIdentity[];
  /** The target's box in the sender's viewport, px. */
  rect: FieldRect;
  rx: number;
  ry: number;
}

export function resolveAnchor(
  anchor: ElementAnchor,
  approx: { x: number; y: number },
  options?: { sender?: Viewport; searchDepth?: number },
): { element: Element; x: number; y: number } | null;
```

Files: `src/dom/element-anchor.ts`, `src/features/pointer-sync.ts` (check at every size,
`element-mismatch` reason), `src/features/scroll-sync.ts` (passes the sender's viewport),
`src/shared/types.ts`, `src/core/delivery-report.ts`, tests.

Known limit: a game that centres a smaller `<canvas>` element itself (instead of letterboxing
inside a full-window canvas) moves the canvas box when the aspect ratio differs, so its
clicks would be dropped. Same-aspect windows, like your two monitors, are unaffected.

**Tested in real tabs:** splash buttons work across sizes. The spin button doesn't: from the
small window a toast appears but the spin still starts; from the big window the other tab's
spin button stays pressed and spins repeatedly. The receiving tab's log showed `pointerdown`
applied, `pointerup` and `click` received but dropped → step 13c.

---

## Step 13c — One decision per press ✅ done (`94cf297`, confirmed in real tabs)

**Issue.** A press is three messages (`pointerdown`, `pointerup`, `click`), and since 13b each
is checked against its element on its own. The spin button changes between down and up (the
game adds a pressed state), so the checks disagree and a press is half-applied:

- down dropped, up and click applied → toast, but the click still spins;
- down applied, up and click dropped → the button is never released, and the game's
  hold-to-spin keeps spinning (no further messages, so no panel flash).

**Fix.**

1. **`pointerdown` decides for the whole press.** Dropped → its `pointerup` and `click` are
   dropped too. Applied → the receiver keeps the element, and `pointerup` goes to it without
   another check (like the browser's pointer capture).
2. **`click` follows the browser's rule.** The sender adds `samePress: true` when its `click`
   landed on the element it pressed; the receiver then clicks the kept element. If the user
   dragged off and released elsewhere, the browser clicks an element containing both, and
   the receiver checks that one normally.
3. **Never leave a button held down.** `pointercancel` is mirrored too (the browser sends it
   instead of `pointerup` when a press is interrupted), and turning mouse sync off mid-press
   sends `pointercancel` to the kept element.

Messages from older builds (no `samePress`) use the kept element for their click. A press
whose `pointerdown` never arrived is checked event by event, as before.

Files: `src/features/pointer-sync.ts` (press state, `samePress`, `pointercancel`),
`src/dom/synthetic-events.ts` (`pointercancel` also ends mouse-compat suppression), tests.

**Tested in real tabs:** the spin button no longer stays pressed or half-applies. One open
item, below.

**Resolved in 13d/13e — spin button from the small window to the big one was dropped.** Big → small passes;
small → big shows the size-mismatch toast and nothing is clicked (the safe failure). The
check is symmetric, so the likely causes are: the UI doesn't scale exactly with the window
ratio (height-based scaling, or a minimum or maximum size), so the scaled box is off by
more than 10%; or the same spot hits a different layer of the button in each window
(icon vs wrapper or glow). Next step if wanted (**13d**): log why a press was dropped on
the receiver (`[SYNC DROPPED] pointerdown: box differs, expected … found …` or
"identity differs at level N"), reproduce once, then decide whether to adjust the
tolerance or scaling, or leave it.

---

## Step 13d — Log why a mirrored press was dropped ✅ done (`1be527e`, confirmed in real tabs)

**Issue.** A dropped press logs nothing on the receiver, so the small → big spin-button drop
(step 13c's open item) can't be explained from the console.

**Fix.** When the receiver drops a press, it logs one line with the reason, in the style of
the existing `[SYNC EXECUTE]` lines, with the element as an inspectable console argument:

```
[SYNC DROPPED] pointerdown: box differs: expected 145×145 at (1726, 846), found 120×120 at (1748, 870) on div.PlayButton_icon__8KJx3 [sender 1280×720, here 1920×1080]
[SYNC DROPPED] pointerdown: identity differs at level 0, classes: [PlayButton_icon__8KJx3] vs [PlayButton_glow__2Hd9a]
[SYNC DROPPED] pointerdown: covered by div.Overlay_root__x1
[SYNC DROPPED] pointerup: its pointerdown was dropped
```

Reasons: nothing at the point; identity differs (first differing level and field, or the
chain length); box differs (expected vs found, both in this viewport); covered by another
element; window size differs and the sender sent no anchor (older build). When the window
sizes differ, both sizes are appended.

- `src/dom/element-anchor.ts`: `matchAnchor()` returns either the match or the reason;
  `resolveAnchor()` stays a thin wrapper.
- `src/core/logger.ts`, `src/shared/types.ts`: `Logger.dropped(label, reason, ...details)`.
- `src/features/pointer-sync.ts`: log each drop, including the up/click/cancel of a dropped
  press.

Logging only; no change to what is applied or dropped.

---

## Step 13e — Box check: allow uniform scaling, compare centres ✅ done (`5f76ea0`, confirmed in real tabs)

**Found with the step 13d log** (small → big, spin button):

```
[SYNC DROPPED] pointerdown: box differs: expected 190×174 at (2345, 1062), found 171×169 at (2363, 1064) on div.PlayButton_icon__8KJx3:nth-of-type(1) [sender 1920×1031, here 2560×1271]
```

The windows have different aspect ratios, so the width ratio (×1.333) and height ratio
(×1.233) differ. The check scaled the sender's box per axis (a stretched 190×174), but the
UI scales the button uniformly (~×1.2 → 171×169): 19px narrower against a 19px tolerance,
so it fails by a hair every time. Big → small happens to stay inside the tolerance; there
the game acts on `pointerdown`, so a dropped `click` (sent to a containing element
when the button re-renders mid-press) doesn't matter.

**Fix.** In the anchor box check (`src/dom/element-anchor.ts`):

- **Size:** accept either a stretch (each axis by its window ratio) or a uniform scale by
  any factor between the two window ratios (±10%), with the aspect ratio kept.
- **Position:** compare box centres as fractions of the window, not top-left corners; a
  box that grows uniformly from a corner-pinned spot moves its corner, not its centre.
- Same tolerance as before: max(4px, 10% of the size). The drop log shows the expected
  centre and the allowed uniform scale.

With the logged numbers: uniform ×1.20 is inside 1.11–1.47, the centres are 8.5px apart
(tolerance 17px) → passes. Tweakpane on a scaled screen (×1.0) still fails; a
neighbouring row still fails on its centre.

Text fields keep their stricter rule (step 13).

---

## Step 14 — Ghost selection and caret ✅ done (`dcef6ff`, fixes `5c8c5fa`, confirmed in real tabs)

**Issue.** Ctrl+A, Shift+arrows and mouse selection aren't mirrored (synthetic keys don't
select), and background windows wouldn't paint a selection anyway.

**Fix.**

- **Sender:** on `selectionchange`, while the focused element is a value field that has a
  selection (text, search, url, tel, textarea: `selectionStart` is `null` for types like
  `number`), send `TEXT_SELECTION { start, end, direction, rect, fingerprint }`,
  rAF-throttled.
- **Receiver:** on the matching field, `setSelectionRange(start, end, direction)` (works
  without focus, so later edits apply to the same range), then draw it: tinted boxes
  (`rgba(0, 255, 255, 0.3)`) over the selected text, or a 1px caret line when the range is
  empty. Cleared with the focus ring (step 12).
- **Measuring text:** a hidden "mirror" element copies the field's font, padding, border,
  letter-spacing, `white-space` (`pre` for inputs, `pre-wrap` for textareas) and width,
  holds the text before, inside and after the selection, and returns the selected span's
  boxes. Then offset by the field's position and its `scrollLeft` / `scrollTop`.

Files: `src/dom/text-geometry.ts` (new: `selectionRects(field, start, end)`),
`src/ui/field-highlight.ts` (selection and caret layer), `src/features/text-sync.ts` (or a
`text-selection.ts`), constants and types.

Tests: the selection range is set on the matching field; measuring is tested with stubbed
mirror geometry; a collapsed range draws a caret; cleared on blur. Text measuring needs a
real check in Chrome (single-line scrolled input, multi-line textarea).

Built in `dcef6ff`.

**Tested in real tabs, found:**

- The sending tab also showed the ghost ring, caret and selection on its own field.
- The other tab's selection didn't always cover the whole selected text.
- After minimizing and restoring the window, typing didn't show the caret in other tabs
  until the field was emptied.
- While typing, the mirrored caret stayed stuck on one character.

**Cause: receivers echo back.** A mirrored click focuses the field in the other tab with
`focus()`, and Chrome reports focus and selection changes made by code as trusted. So that
tab sent its own focus and selection back. Writing the mirrored value moves its caret to the
end, and that came back as a selection the sending tab applied to the real field with
`setSelectionRange`, moving the user's caret mid-typing. The two tabs kept overwriting each
other's range.

**Fix (part of step 14):**

1. **Only the tab being worked in sends.** Focus and selection messages go out only while
   `document.hasFocus()`. Blur messages are exempt; they only remove rings.
2. **A focused tab never draws on itself.** While `document.hasFocus()`, a tab ignores
   focus and selection messages and removes its ring; it never sets the range of the field
   the user is typing in.
3. **Caret while typing.** The selection is also read after `input`, `keyup`, `pointerup`
   and `focusin`, not only on `selectionchange` (Chrome doesn't reliably report caret moves
   caused by typing).
4. **After the window regains focus**, the field's `focusin` also sends the current range,
   so the caret comes back without moving it.

---

## Step 15 — "Same window only" switch ✅ done (`f651a3d`, verified by the e2e `same-window` scenario)

**Issue.** Mirroring reaches every target tab in every window. That's right when you mirror
across windows (your two monitors), but in a split view you may want only the two tabs side
by side, not another localhost tab in some other window.

**Fix.** A new panel switch, **Same Window Only** (config key `sameWindowOnly`, default
**off**, so today's behaviour stays). When on, a tab's events reach only tabs in its own
window. Chrome's split view keeps both tabs in one window, so a split view keeps working.

- **Sender:** the transport adds `scope: "window"` to broadcasts while the switch is on. The
  setting is global like the others, so every tab sends the same scope.
- **Worker:** the tab cache also stores each tab's `windowId` (kept current with
  `tabs.onAttached` when a tab is dragged into another window). With `scope: "window"`, only
  tabs with the sender's `windowId` are targets.
- **Panel:** a new switch row; the setting isn't a sync feature, so the engine ignores it.

```ts
// src/background/router.ts
const targets = [...tabs.entries()]
  .filter(([tabId, state]) => tabId !== sender.tab?.id)
  .filter(([, state]) => message.scope !== "window" || state.windowId === sender.tab?.windowId)
  .map(([tabId]) => tabId);
```

Files: `src/shared/constants.ts` (`DEFAULT_CONFIG.sameWindowOnly`),
`src/ui/panel-template.ts` and `panel.ts` (switch), `src/core/messaging.ts` (scope from
config), `src/background/router.ts` (window filter, `onAttached`), tests for each.

---

## Step 16 — Remember the panel position across reloads ✅ built (one position for all tabs; verified by the e2e `panel-position` scenario)

**Issue.** The panel goes back to the top-right corner on every reload, and a window resize
can leave it partly off screen.

**Fix.**

- **Save** the position when a drag ends, local or followed (step 8), in
  `chrome.storage.local` under `panelPosition`.
- **Store it relative to the nearest edges,** so a panel kept near the right edge stays
  there in a wider or narrower window, instead of drifting by a fixed `left`:

  ```ts
  { x: { edge: "right", offset: 10 }, y: { edge: "top", offset: 10 } }
  ```

- **Restore** it when the panel is created, clamped to the viewport like a drag.
- **Re-clamp** on window resize, so the panel never ends up off screen.
- **Not live:** a saved position from another tab doesn't move this panel while it's open
  (panels that should move together already do through drag sync). It's applied on the next
  load.

Files: `src/ui/panel.ts` (save, restore, resize clamp), `src/ui/panel-position.ts` (new: edge
conversion, unit-tested), tests.

❓ **One position for all tabs, or one per site?** Recommended: one for all tabs (they show
the same app, and drag sync keeps panels together anyway). Per site (`localhost:8080` vs the
CI host) is possible if the layouts differ.

---

## Step 16b — Panel position through the settings store; "Panel Drag" switch ✅ built (verified by the e2e `panel-position` and `panel-drag` scenarios)

**Issue.** Step 16 reads and writes `chrome.storage` directly from the panel, unlike every
other setting, which goes through the settings store (`src/core/state-store.ts`); its tests
need the chrome mock. And panels following each other's drags (step 8) are tied to "Mouse
Events", though that's a separate kind of mirroring.

**Fix.**

1. **Position in the store.** New key `panelPosition` in `DEFAULT_CONFIG` (default `null`:
   never moved). The panel restores it once the store is `ready` and saves it with
   `config.set`. Stored values are still validated (`isEdgePosition`). An open panel does
   **not** follow a position saved in another tab (decided); it applies on the next load.
   The direct storage helpers go away.
2. **"Panel Drag" switch** (`syncPanel`, default on): drag sync gets its own setting
   instead of "Mouse Events". Remembering the position has no switch: it's local and always
   wanted. A followed drag still saves the new position.

Files: `src/shared/constants.ts`, `src/shared/types.ts` (`EdgePosition` moves here),
`src/ui/panel.ts`, `src/ui/panel-template.ts`, `src/ui/panel-position.ts`,
`src/features/panel-sync.ts`, tests; e2e: a `panel-drag` scenario for the switch.

---

## Step 17 — Keyboard activation: Enter submits, Enter/Space press buttons ✅ built (verified by the e2e `keys` scenario)

**Issue.** Synthetic key events have no default actions. A mirrored Enter in a text field
doesn't submit its form, and Enter or Space on a focused button doesn't press it, although
the same key does in the sending tab.

**Fix.** After dispatching a mirrored key that the page didn't cancel
(`defaultPrevented`), keyboard sync performs the browser's default action itself:

| Key             | Target                                                        | Default action performed                                                                                                                                                   |
| --------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter (keydown) | text-like `<input>` in a form                                 | implicit submission: click the form's default (first) submit button; with no submit button, `form.requestSubmit()` only if it's the form's only text field (the HTML rule) |
| Enter (keydown) | `<button>`, `<a href>`, `<input type=submit/button/reset>`    | `click()`                                                                                                                                                                  |
| Space (keyup)   | `<button>`, `<input type=checkbox/radio/submit/button/reset>` | `click()` (Space activates on release)                                                                                                                                     |

- Never in `<textarea>` (Enter inserts a newline; text sync mirrors that).
- Only when the key arrives with no modifiers, like the browser.
- A synthetic `click()` runs the element's activation (toggling a checkbox, submitting), as
  verified earlier in this review.

Files: `src/dom/keyboard-activation.ts` (new: `performKeyDefault(target, type, key)`,
unit-tested per row), `src/features/keyboard-sync.ts` (call it after dispatch).

Tests: each row of the table; nothing happens when the page cancels the key, for textarea,
or with modifiers; the single-field rule for forms without a submit button.

---

## Also done (outside the numbered steps)

- **E2E test tool** (`771fd8d`, extended through step 17): `e2e/`, `npm run test:e2e`. Runs
  the built extension in headless Edge/Chromium with a throwaway profile against a real page,
  driven over the DevTools Protocol with trusted input. Configured through `E2E_*` variables
  in `.env`; see `e2e/README.md`. Scenarios: extension-loads, click, size-mismatch, text,
  toggle, keys, panel-position, panel-drag, same-window.
- **URL filters in `.env`** (`771fd8d`): `VITE_TARGET_MATCHES` (Chrome match patterns) feeds
  the manifest's content-script matches and the worker's host check; local dev servers only
  when unset. The manifest became a template at `src/manifest.json`.
- **Look-alike siblings** (`835ed92`): the element check's sibling position skips the
  extension's own elements and counts only siblings with the same tag and classes (the debug
  toggle was dropped because tabs held different extension elements).
- **Tooling:** `lint:fix` / `fmt:check` scripts (`8ee1d13`); unit tests in the `vmThreads`
  pool (`5dd369b`); plain "x" instead of "×" in strings (`905a048`).
- **Pull request:** #4.

## Not doing (unless you want it)

Nothing at the moment.
