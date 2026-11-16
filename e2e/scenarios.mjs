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
};

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
    // Same place in every tab, away from the page's own top-right controls.
    await page.movePanel({ left: 10, top: page.size.height - 200 });
    pages.push(page);
  }
  // Let the game finish its loading screen before anything is clicked.
  await pages[0]
    .waitFor(
      `[...document.querySelectorAll("body *")].some((el) => (el.innerText || "").trim() === ${JSON.stringify(ctx.config.selectors.clickText)})`,
      { what: `"${ctx.config.selectors.clickText}" on the page` },
    )
    .catch(() => {});
  await sleep(ctx.config.settle);
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
      ctx.check("panel shows its switches", switches >= 6, `${switches} switches`);
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
      // The fields sit further down the panel's own scrolling list: bring the first one into
      // view the same way in both windows (setup, not under test).
      for (const page of [sender, receiver]) {
        await page.waitFor(`!!(${laidOutField(textField)})()`, {
          what: `a ${textField} with a box`,
        });
        await page.evaluate(`(${laidOutField(textField)})().scrollIntoView({ block: "center" })`);
      }
      await sleep(300);
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
