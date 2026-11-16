/**
 * End-to-end scenarios against a real page with the real extension. Each opens its own fresh
 * tabs (closed afterwards) and records checks; a thrown error fails the scenario.
 *
 * The first page in a scenario is the sender: it gets focus, like the window you work in.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Panel switch id prefixes (see src/ui/panel-template.ts). */
const SWITCH = {
  mouse: "sync-mouse-toggle",
  keyboard: "sync-key-toggle",
  text: "sync-text-toggle",
  sameWindow: "sync-window-toggle",
  panel: "sync-panel-toggle",
};

/** Lets the page finish its loading screen (until E2E_CLICK_TEXT shows) before any input. */
async function untilReady(ctx, page) {
  const text = JSON.stringify(ctx.config.selectors.clickText);
  await page
    .waitFor(
      `[...document.querySelectorAll("body *")].some((el) => (el.innerText || "").trim() === ${text})`,
      { what: `${text} on the page` },
    )
    .catch(() => {});
  await sleep(ctx.config.settle);
}

/**
 * Puts every tab's panel at the same spot, bottom-left, away from the page's own top-right
 * controls. A position saved by an earlier scenario is restored once settings load and can
 * land after the first move, so repeat until all panels agree.
 */
async function alignPanels(pages) {
  const key = async (page) => {
    const box = await page.panelBox();
    return box && `${Math.round(box.left)},${Math.round(box.top)}`;
  };
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const page of pages) await page.movePanel({ left: 10, top: page.size.height - 200 });
    await sleep(300);
    const keys = await Promise.all(pages.map(key));
    if (keys[0] && keys.every((k) => k === keys[0])) return;
  }
}

/** Opens tabs, loads the page in each, and waits until the extension is running there. */
async function openPages(ctx, specs) {
  const pages = [];
  for (const spec of specs) {
    const page = await ctx.browser.newPage({ size: ctx.config.size, ...spec });
    await page.goto(ctx.config.url);
    await page.waitForLog("[SYNC INITIALIZED]");
    await page.waitFor("!!document.getElementById('mirror-sync-panel')", {
      what: "the extension panel",
    });
    pages.push(page);
  }
  await untilReady(ctx, pages[0]);
  await alignPanels(pages);
  await pages[0].focus();
  // One window in front: the first page is focused, the others aren't (see setExtensionFocus).
  for (const [index, page] of pages.entries()) await page.setExtensionFocus(index === 0);
  return pages;
}

/** Visible own-UI elements that look like the ghost focus ring (2px cyan outline). */
const RING_VISIBLE = `[...document.querySelectorAll("[data-mirror-sync-ui]")].some((el) =>
  el.style.border.includes("2px") && el.style.display === "block")`;

/** Clicks `point` in `sender` and returns the lines `receiver` logged for that press. */
async function pressAndCollect(sender, receiver, point) {
  const since = receiver.logs.length;
  await sender.click(point);
  await receiver.waitForLog(/\[SYNC (EXECUTE|DROPPED)\] click/, { since }).catch(() => {});
  return receiver.logs.slice(since);
}

export const scenarios = [
  {
    name: "extension-loads",
    description: "The extension's worker runs, and the content script and panel load on the page.",
    async run(ctx) {
      const [page] = await openPages(ctx, [{ newWindow: true }]);
      const switches = await page.evaluate(
        "document.getElementById('mirror-sync-panel').shadowRoot.querySelectorAll('.toggle-switch input').length",
      );
      ctx.check("panel shows its switches", switches >= 7, `${switches} switches`);
      ctx.check("no page errors", page.errors.length === 0, page.errors.join("\n"));
    },
  },

  {
    name: "click",
    description: "A click on the page's button in one window is mirrored to the other.",
    async run(ctx) {
      const [sender, receiver] = await openPages(ctx, [{ newWindow: true }, { newWindow: true }]);
      await sender.setSwitch(SWITCH.mouse, true);
      await sleep(300);

      const point = await sender.centerOfText(ctx.config.selectors.clickText);
      if (!point) throw new Error(`No "${ctx.config.selectors.clickText}" button on the page`);
      const lines = await pressAndCollect(sender, receiver, point);

      for (const type of ["pointerdown", "pointerup", "click"]) {
        ctx.check(
          `receiver applied ${type}`,
          lines.some((line) => line.startsWith(`[SYNC EXECUTE] ${type}`)),
          lines.filter((line) => line.includes(type)).join("\n"),
        );
      }
      const gone = await Promise.all(
        [sender, receiver].map((page) =>
          page
            .waitFor(
              `!${JSON.stringify(ctx.config.selectors.clickText)} || ![...document.querySelectorAll("body *")].some((el) => (el.innerText || "").trim() === ${JSON.stringify(ctx.config.selectors.clickText)} && el.getBoundingClientRect().width > 0)`,
              {
                timeout: 10000,
                what: "the button to go away",
              },
            )
            .then(
              () => true,
              () => false,
            ),
        ),
      );
      ctx.check(
        "the button reacted in both windows",
        gone.every(Boolean),
        `sender ${gone[0]}, receiver ${gone[1]}`,
      );
    },
  },

  {
    name: "size-mismatch",
    description: "A click from a bigger window reaches a smaller one when the page scales with it.",
    async run(ctx) {
      const [sender, receiver] = await openPages(ctx, [
        { newWindow: true },
        { newWindow: true, size: ctx.config.smallSize },
      ]);
      await sender.setSwitch(SWITCH.mouse, true);
      await sleep(300);

      const point = await sender.centerOfText(ctx.config.selectors.clickText);
      if (!point) throw new Error(`No "${ctx.config.selectors.clickText}" button on the page`);
      const lines = await pressAndCollect(sender, receiver, point);
      const drop = lines.find((line) => line.startsWith("[SYNC DROPPED]"));
      ctx.check(
        `click applied at ${sender.size.width}x${sender.size.height} → ${receiver.size.width}x${receiver.size.height}`,
        lines.some((line) => line.startsWith("[SYNC EXECUTE] click")),
        drop ?? lines.join("\n"),
      );
    },
  },

  {
    name: "text",
    description:
      "Typing into a text field is mirrored, with a ghost ring and selection only in the other window.",
    async run(ctx) {
      const { toggle, textField } = ctx.config.selectors;
      const [sender, receiver] = await openPages(ctx, [{ newWindow: true }, { newWindow: true }]);
      await sender.setSwitch(SWITCH.mouse, true);
      await sender.setSwitch(SWITCH.text, true);
      await sleep(300);

      // Open the panel holding the field (the click is mirrored, so it opens in both).
      const togglePoint = await sender.centerOf(toggle);
      if (!togglePoint) throw new Error(`No ${toggle} on the page`);
      await sender.click(togglePoint);
      // Opening the receiver's panel by mirrored click is the click scenario's business; if it
      // didn't open here, open it directly (a page-script click, which isn't mirrored).
      const inView = `(() => { const r = (${laidOutField(textField)})()?.getBoundingClientRect(); return !!r && r.right <= innerWidth && r.left >= 0; })()`;
      for (const page of [sender, receiver]) {
        const open = await page.waitFor(inView, { timeout: 3000 }).then(
          () => true,
          () => false,
        );
        if (!open) {
          await page.evaluate(`document.querySelector(${JSON.stringify(toggle)})?.click()`);
          ctx.note(
            `opened the panel directly in ${page === sender ? "the sender" : "the receiver"}`,
          );
        }
      }
      // The fields sit further down the panel's own scrolling list: bring the first one into
      // view in both windows (setup, not under test). The panel animates open, so repeat
      // until the field is at the same spot in both, as mirroring requires.
      const fieldBox = (page) =>
        page.evaluate(
          `(() => { const r = (${laidOutField(textField)})()?.getBoundingClientRect(); return r && [r.left, r.top, r.width, r.height].map(Math.round).join(","); })()`,
        );
      let aligned = false;
      for (let attempt = 0; attempt < 15 && !aligned; attempt++) {
        for (const page of [sender, receiver]) {
          await page.waitFor(`!!(${laidOutField(textField)})()`, {
            what: `a ${textField} with a box`,
          });
          await page.evaluate(
            `(${laidOutField(textField)})().scrollIntoView({ block: "center", behavior: "instant" })`,
          );
        }
        await sleep(300);
        const [a, b] = [await fieldBox(sender), await fieldBox(receiver)];
        aligned = a !== null && a === b;
      }
      if (!aligned) {
        throw new Error(
          `Setup: the text field isn't at the same spot in both windows (${await fieldBox(sender)} vs ${await fieldBox(receiver)})`,
        );
      }
      const field = await sender.waitFor(`(${fieldCenter(textField)})()`, {
        what: `a visible ${textField}`,
      });
      await receiver.waitFor(`(${fieldCenter(textField)})()`, {
        what: `a visible ${textField} in the receiver`,
      });

      await sender.click(field);
      const text = `e2e-${Date.now() % 100000}`;
      await sender.evaluate("document.activeElement.select?.()");
      await sender.type(text);

      const mirrored = await receiver
        .waitFor(`(${fieldValue(textField)})() === ${JSON.stringify(text)}`, {
          timeout: 5000,
          what: "the typed text",
        })
        .then(
          () => true,
          () => false,
        );
      const boxes = async (page) =>
        page.evaluate(
          `JSON.stringify((() => { const f = (${laidOutField(textField)})(); const r = f?.getBoundingClientRect(); return r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })())`,
        );
      ctx.check(
        "typed text reached the other window's field",
        mirrored,
        [
          `value there: ${await receiver.evaluate(`(${fieldValue(textField)})()`)}`,
          `field box: sender ${await boxes(sender)}, receiver ${await boxes(receiver)}`,
          ...receiver.logs.filter((line) => /TEXT_|SYNC/.test(line)).slice(-4),
        ].join("\n"),
      );

      const ring = await receiver.waitFor(RING_VISIBLE, { timeout: 3000 }).then(
        () => true,
        () => false,
      );
      ctx.check("ghost focus ring in the other window", ring);
      ctx.check(
        "no ghost ring in the window being typed in",
        !(await sender.evaluate(RING_VISIBLE)),
      );

      await sender.evaluate("document.activeElement.setSelectionRange(0, 3)");
      const selected = await receiver
        .waitFor(
          `(() => { const f = (${fieldElement(textField)})(); return f && f.selectionStart === 0 && f.selectionEnd === 3; })()`,
          { timeout: 3000 },
        )
        .then(
          () => true,
          () => false,
        );
      ctx.check("selection reached the other window's field", selected);
      const drawn = await receiver.evaluate(
        `[...document.querySelectorAll("[data-mirror-sync-ui] div div")].some((el) => el.style.background.includes("0.3"))`,
      );
      ctx.check("ghost selection drawn in the other window", drawn);
    },
  },

  {
    name: "toggle",
    description:
      "Clicking the page's toggle is mirrored even when the tabs hold different extension elements.",
    async run(ctx) {
      const { toggle } = ctx.config.selectors;
      const [sender, receiver] = await openPages(ctx, [{ newWindow: true }, { newWindow: true }]);
      await sender.setSwitch(SWITCH.mouse, true);
      await sleep(300);
      // Which of the extension's own elements exist differs per tab (a focus ring appears
      // only where one was shown). Give the receiver an extra one at the top of <body>.
      await receiver.evaluate(`(() => {
        const extra = document.createElement("div");
        extra.setAttribute("data-mirror-sync-ui", "");
        document.body.prepend(extra);
      })()`);

      for (const round of ["open", "close"]) {
        const point = await sender.centerOf(toggle);
        if (!point) throw new Error(`No ${toggle} on the page`);
        const lines = await pressAndCollect(sender, receiver, point);
        const drop = lines.find((line) => line.startsWith("[SYNC DROPPED]"));
        ctx.check(
          `receiver applied the ${round} click`,
          lines.some((line) => line.startsWith("[SYNC EXECUTE] click")),
          drop ?? lines.join("\n"),
        );
        await sleep(800);
      }
    },
  },

  {
    name: "panel-position",
    description: "A dragged panel starts at the same place in tabs opened afterwards.",
    async run(ctx) {
      const first = await ctx.browser.newPage({ size: ctx.config.size });
      await first.goto(ctx.config.url);
      await first.waitForLog("[SYNC INITIALIZED]");
      // Drag once the page has loaded, as a user would.
      await untilReady(ctx, first);
      const before = await first.panelBox();
      if (!before) throw new Error("No extension panel on the page");

      // Drag it by its handle to near the bottom-left corner.
      const target = { x: 40, y: ctx.config.size.height - before.height - 40 };
      await first.drag(before.handle, target);
      const after = await first.panelBox();
      const moved = Math.abs(after.left - before.left) > 50;
      ctx.check(
        "the panel moved with the drag",
        moved,
        `from ${Math.round(before.left)},${Math.round(before.top)} to ${Math.round(after.left)},${Math.round(after.top)}`,
      );

      // A new tab, same size: the panel should start where it was left.
      const second = await ctx.browser.newPage({ size: ctx.config.size });
      await second.goto(ctx.config.url);
      await second.waitForLog("[SYNC INITIALIZED]");
      const restored = await settledPanelBox(second);
      const same =
        restored &&
        Math.abs(restored.left - after.left) <= 2 &&
        Math.abs(restored.top - after.top) <= 2;
      ctx.check(
        "a new tab starts the panel at the saved place",
        same,
        restored
          ? `at ${Math.round(restored.left)},${Math.round(restored.top)}, expected ${Math.round(after.left)},${Math.round(after.top)}`
          : "not placed",
      );

      // A bigger window keeps it at the same distance from the left and bottom edges.
      const big = { width: ctx.config.size.width + 320, height: ctx.config.size.height + 180 };
      const third = await ctx.browser.newPage({ size: big });
      await third.goto(ctx.config.url);
      await third.waitForLog("[SYNC INITIALIZED]");
      const scaled = await settledPanelBox(third);
      const bottomBefore = ctx.config.size.height - (after.top + after.height);
      const bottomNow = scaled && big.height - (scaled.top + scaled.height);
      ctx.check(
        "in a bigger window it keeps its distance to the nearest edges",
        scaled &&
          Math.abs(scaled.left - after.left) <= 2 &&
          Math.abs(bottomNow - bottomBefore) <= 2,
        scaled
          ? `left ${Math.round(scaled.left)}, bottom gap ${Math.round(bottomNow)} (was ${Math.round(bottomBefore)})`
          : "no panel",
      );
    },
  },

  {
    name: "panel-drag",
    description: "Dragging the panel moves the other window's panel too, unless Panel Drag is off.",
    async run(ctx) {
      // openPages puts both panels at the same spot, which following requires.
      const [sender, receiver] = await openPages(ctx, [{ newWindow: true }, { newWindow: true }]);
      await sender.setSwitch(SWITCH.panel, true);
      await sleep(300);

      const dragBy = async (dx) => {
        const start = await sender.panelBox();
        const before = await receiver.panelBox();
        await sender.drag(start.handle, { x: start.handle.x + dx, y: start.handle.y - 60 });
        await sleep(800);
        const moved = await sender.panelBox();
        const other = await receiver.panelBox();
        return {
          followed: Math.abs(other.left - moved.left) <= 2 && Math.abs(other.top - moved.top) <= 2,
          stayed: Math.abs(other.left - before.left) <= 2 && Math.abs(other.top - before.top) <= 2,
          detail: `sender ${Math.round(moved.left)},${Math.round(moved.top)}; other ${Math.round(other.left)},${Math.round(other.top)}`,
        };
      };

      const on = await dragBy(200);
      ctx.check("the other window's panel followed the drag", on.followed, on.detail);

      await sender.setSwitch(SWITCH.panel, false);
      await sleep(300);
      const off = await dragBy(150);
      ctx.check("with Panel Drag off, it stays put", off.stayed && !off.followed, off.detail);

      await sender.setSwitch(SWITCH.panel, true);
    },
  },

  {
    name: "same-window",
    description: "With Same Window Only, clicks reach tabs in the sender's window only.",
    async run(ctx) {
      const { toggle } = ctx.config.selectors;
      // A and B share a window; C has its own.
      const [a, b, c] = await openPages(ctx, [
        { newWindow: true },
        { newWindow: false },
        { newWindow: true },
      ]);
      await a.focus();
      await a.setSwitch(SWITCH.mouse, true);
      await a.setSwitch(SWITCH.sameWindow, true);
      await sleep(300);

      const point = await a.centerOf(toggle);
      if (!point) throw new Error(`No ${toggle} on the page`);
      const reached = async () => {
        const since = { b: b.logs.length, c: c.logs.length };
        await a.click(point);
        await sleep(1500);
        const got = (page, from) =>
          page.logsSince(from, "[REMOTE EVENT RECEIVED] POINTER_EVENT").length > 0;
        return { b: got(b, since.b), c: got(c, since.c) };
      };

      const scoped = await reached();
      ctx.check("same-window tab received the click", scoped.b);
      ctx.check("other-window tab did not", !scoped.c);

      await a.setSwitch(SWITCH.sameWindow, false);
      await sleep(300);
      const everywhere = await reached();
      ctx.check("with the switch off, the other window receives it", everywhere.c);
    },
  },
];

/**
 * The panel's box once it has been placed and stopped moving: the saved position is applied
 * when the panel is attached and again once its contents have their final size.
 */
async function settledPanelBox(page, { timeout = 10000 } = {}) {
  const end = Date.now() + timeout;
  let last = null;
  let stable = 0;
  while (Date.now() < end) {
    const placed = await page.evaluate(
      `document.getElementById("mirror-sync-panel")?.style.left !== ""`,
    );
    const box = placed ? await page.panelBox() : null;
    const same =
      box && last && Math.abs(box.left - last.left) < 0.5 && Math.abs(box.top - last.top) < 0.5;
    stable = same ? stable + 1 : 0;
    if (stable >= 3) return box;
    last = box;
    await sleep(150);
  }
  return last;
}

/** Code (as text) finding the first text field that has a box (in an open section). */
function laidOutField(selector) {
  return `() => [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })`;
}

/** Code (as text) finding the first text field fully inside the viewport. */
function fieldElement(selector) {
  return `() => [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  })`;
}

function fieldCenter(selector) {
  return `() => { const el = (${fieldElement(selector)})(); if (!el) return null;
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }`;
}

function fieldValue(selector) {
  return `() => (${fieldElement(selector)})()?.value ?? null`;
}
