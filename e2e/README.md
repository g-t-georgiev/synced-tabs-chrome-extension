# End-to-end tests

Runs the real, built extension in a headless browser with a throwaway profile, opens a real
page in several tabs and windows, and checks that input in one is mirrored to the others:
the background worker, routing, delivery reports and content script all run for real.

```bash
npm run test:e2e
```

That builds the extension, then runs every scenario. To run some against the current
`dist/`, or to watch:

```bash
node e2e/run.mjs --scenario=click,text
```

```bash
node e2e/run.mjs --headed
```

## Setup

1. Copy `.env.example` to `.env` (not committed) and set `E2E_URL` to the page to test.
   `VITE_TARGET_MATCHES` must cover it, or the extension won't run there.
2. Have **Microsoft Edge** or **Chromium** installed. Branded Google Chrome ignores
   `--load-extension`, so it can't load the unpacked extension. Edge is found
   automatically; otherwise set `E2E_BROWSER`.

Every other setting (window sizes, timeouts, the page elements used, which scenarios run)
is in `.env.example`. Settings come from Vite+'s `.env` files with the `E2E_` prefix, so
they are never inlined into the extension. The full URL is never printed, only its host.

## Scenarios

| Name              | Checks                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension-loads` | The extension's worker runs; the content script and panel load.                                                                                       |
| `click`           | A trusted click on a button (`E2E_CLICK_TEXT`) is applied in the other window.                                                                        |
| `size-mismatch`   | The same click from a bigger window reaches a smaller one.                                                                                            |
| `text`            | Typing into a text field (`E2E_TEXT_FIELD_SELECTOR`) is mirrored; the ghost focus ring and selection show only in the other window.                   |
| `toggle`          | Clicking the page's toggle (`E2E_TOGGLE_SELECTOR`) open and closed is mirrored, even when the tabs hold different extension elements.                 |
| `keys`            | A mirrored Enter presses a button and Space toggles a checkbox in the other tab (on controls the scenario adds to both tabs).                         |
| `panel-position`  | A panel dragged by its handle starts at the same place in tabs opened afterwards, and at the same distance from its nearest edges in a bigger window. |
| `panel-drag`      | Dragging the panel moves the other window's panel too (same spot), and not with the "Panel Drag" switch off.                                          |
| `same-window`     | With "Same Window Only", a click reaches a tab in the sender's window, not one in another window; with it off, both.                                  |

Each scenario opens fresh tabs and closes them afterwards. A failed check prints details
and saves a screenshot of every tab to `e2e/output/` (ignored by git).

## How it works

- `lib/browser.mjs` starts the browser (`--headless=new`, `--load-extension`, a temporary
  `--user-data-dir`), connects over the DevTools Protocol, and opens tabs or windows.
- `lib/page.mjs` drives one tab: navigation, viewport size, trusted mouse and text input
  (`Input.*`), console capture, evaluation in the page or in the content script's world.
- `lib/cdp.mjs` is a dependency-free protocol client (Node 22+ has `WebSocket`).

**Focus.** A desktop has one window in front; headless browsers report every window as
focused (`document.hasFocus()`), and the extension relies on that for focus and selection
mirroring. Scenarios therefore pin it per tab, inside the content script's world only: the
first tab is the one being worked in, the others aren't.

**The panel** starts in the top-right corner, where pages often have controls (the game's
`debug (T)` button). Scenarios move it to the bottom-left first.

## Limits

- Chrome's split view and multiple monitors can't be reproduced; separate windows of
  different sizes are the closest equivalent.
- In a window shared by several tabs, only the front tab renders. Mirroring into the
  others still works, but the ghost cursor and ring only redraw while visible.
- Scenarios depend on the page: a page without `E2E_CLICK_TEXT` or text fields fails those
  scenarios. Point the selectors at your page's elements.
