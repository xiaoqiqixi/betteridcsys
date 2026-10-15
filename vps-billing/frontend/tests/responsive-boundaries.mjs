// Diagnostic reproduction only: these measurements do not replace e2e gates.
// Fixtures stay in the DOM; no input/change/submit event or API write is sent.
const widths = [320, 375, 720, 721, 768, 1440];
const locales = ["zh-CN", "en"];
const fixtures = {
  ascii: { site: "S".repeat(120), company: "C".repeat(240) },
  cjk: { site: "云".repeat(40), company: "公".repeat(80) },
};

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Finish only current CSS transitions, including the owned mobile drawer.
    for (const animation of document
      .querySelector(".sidebar")
      ?.getAnimations() || [])
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime))
        animation.finish();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function selectLocale(page, locale) {
  await page
    .locator(".preference-controls select")
    .first()
    .selectOption(locale);
  await settle(page);
}

async function installFixture(page, surface, fixture) {
  await page.evaluate(
    ({ surface, fixture }) => {
      if (window.__asterBoundaryFixture)
        throw new Error("Boundary fixture was not restored");
      const saved = [];
      window.__asterBoundaryFixture = saved;
      const replace = (selector, text) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error("Required boundary fixture node missing");
        saved.push({ element, nodes: [...element.childNodes] });
        element.replaceChildren(document.createTextNode(text));
      };
      if (surface === "login") {
        replace(".login-brand strong", fixture.site);
        replace(".small-brand", fixture.site);
        replace(".login-story .eyebrow", fixture.site);
        replace(
          ".login-footnote",
          fixture.company +
            (document.documentElement.lang === "en"
              ? " · Cloud services"
              : " · 云服务管理"),
        );
      } else {
        replace(".sidebar .brand strong", fixture.site);
        replace(".workspace-switch small", fixture.company);
        replace(".main-footer > span:first-child", fixture.company);
        const group = document.querySelector(".price-input");
        const input = group?.querySelector("input");
        const code = group?.querySelector("span:last-child");
        if (!input || !code)
          throw new Error("Required boundary price fixture missing");
        saved.push({ element: group, nodes: [...group.childNodes] });
        saved.push({
          input,
          value: input.value,
          scrollLeft: input.scrollLeft,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
          selectionDirection: input.selectionDirection,
        });
        const prefix = code.cloneNode(false);
        const suffix = code.cloneNode(false);
        prefix.textContent = "P".repeat(24);
        suffix.textContent = "S".repeat(24);
        // CSS stress fixture for a legal six-decimal format at MaxMinor.
        // Preserve the current input/code nodes and Vue model: this does not
        // make the selected two-decimal CNY format accept six-decimal writes.
        input.value = "9007199254.740991";
        group.replaceChildren(prefix, input, suffix, code);
      }
    },
    { surface, fixture },
  );
  await settle(page);
}

async function restoreFixture(page) {
  await page.evaluate(() => {
    const saved = window.__asterBoundaryFixture;
    if (!saved) return;
    for (const item of saved.toReversed()) {
      if (item.input) {
        item.input.value = item.value;
        item.input.setSelectionRange(
          item.selectionStart,
          item.selectionEnd,
          item.selectionDirection,
        );
        item.input.scrollLeft = item.scrollLeft;
      } else item.element.replaceChildren(...item.nodes);
    }
    delete window.__asterBoundaryFixture;
  });
}

async function measurements(page, targets) {
  return page.evaluate((targets) => {
    const rect = (box) => ({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
    return targets.map(({ id, selector, container }) => {
      const element = document.querySelector(selector);
      const parent = document.querySelector(container);
      if (!element || !parent)
        throw new Error("Required boundary measurement node missing");
      const box = element.getBoundingClientRect();
      const parentBox = parent.getBoundingClientRect();
      const style = getComputedStyle(element);
      let visible = box.width > 0 && box.height > 0;
      let left = 0;
      let right = innerWidth;
      for (let node = element; node; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (
          css.display === "none" ||
          css.visibility !== "visible" ||
          node.getAttribute("aria-hidden") === "true" ||
          node.inert
        )
          visible = false;
        if (/(hidden|clip|auto|scroll)/.test(css.overflowX)) {
          const clip = node.getBoundingClientRect();
          left = Math.max(left, clip.left + node.clientLeft);
          right = Math.min(
            right,
            clip.left + node.clientLeft + node.clientWidth,
          );
        }
      }
      const isInput = element instanceof HTMLInputElement;
      const range = document.createRange();
      range.selectNodeContents(element);
      const fragments = isInput
        ? []
        : [...range.getClientRects()].filter(
            (part) => part.width > 0 && part.height > 0,
          );
      const textBox = fragments.length ? range.getBoundingClientRect() : null;
      const contentWidth = Math.max(
        0,
        box.width -
          parseFloat(style.borderLeftWidth || 0) -
          parseFloat(style.borderRightWidth || 0) -
          parseFloat(style.paddingLeft || 0) -
          parseFloat(style.paddingRight || 0),
      );
      let textWidth = textBox?.width || 0;
      if (isInput) {
        const canvas = document.createElement("canvas").getContext("2d");
        canvas.font = style.font;
        textWidth = canvas.measureText(element.value).width;
      }
      const extent = textBox || box;
      return {
        id,
        visible,
        rect: rect(box),
        container_rect: rect(parentBox),
        text_rect: textBox ? rect(textBox) : null,
        line_count: new Set(fragments.map((part) => Math.round(part.top * 2)))
          .size,
        client_width: element.clientWidth,
        scroll_width: element.scrollWidth,
        content_width: contentWidth,
        text_width: textWidth,
        visible_width: visible
          ? Math.max(
              0,
              Math.min(extent.right, right) - Math.max(extent.left, left),
            )
          : 0,
        overflow_left: visible ? Math.max(0, parentBox.left - extent.left) : 0,
        overflow_right: visible
          ? Math.max(0, extent.right - parentBox.right)
          : 0,
      };
    });
  }, targets);
}

const loginTargets = [
  ["login-brand", ".login-brand strong", ".login-brand"],
  ["login-small-brand", ".small-brand", ".login-card"],
  ["login-eyebrow", ".login-story .eyebrow", ".login-story"],
  ["login-footnote", ".login-footnote", ".login-story"],
];
const sidebarTargets = [
  ["sidebar-brand", ".sidebar .brand strong", ".sidebar"],
  ["workspace-company", ".workspace-switch small", ".workspace-switch"],
];
const priceTargets = [
  ["footer-company", ".main-footer > span:first-child", ".main-footer"],
  ["price-prefix", ".price-input span:first-child", ".price-input"],
  ["price-input", ".price-input input", ".price-input"],
  ["price-suffix", ".price-input span:nth-last-child(2)", ".price-input"],
  ["price-code", ".price-input span:last-child", ".price-input"],
];
const breadcrumbTargets = [
  ["breadcrumb-root", ".breadcrumbs > span", ".breadcrumbs"],
  ["breadcrumb-current", ".breadcrumbs > b", ".breadcrumbs"],
];
const targets = (entries) =>
  entries.map(([id, selector, container]) => ({ id, selector, container }));

async function record(page, surface, fixture, locale, measured) {
  const documentSize = await page.evaluate(() => ({
    viewport_width: innerWidth,
    scroll_width: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    ),
  }));
  const checks = [
    {
      id: "document-no-horizontal-overflow",
      passed: documentSize.scroll_width <= documentSize.viewport_width + 1,
    },
  ];
  for (const item of measured) {
    const intentionallyHidden =
      surface === "login" &&
      page.viewportSize().width <= 720 &&
      ["login-eyebrow", "login-footnote"].includes(item.id);
    checks.push({
      id: item.id + "-visible",
      passed: item.visible || intentionallyHidden,
    });
    checks.push({
      id: item.id + "-within-container",
      passed:
        intentionallyHidden ||
        (item.visible && item.overflow_left <= 1 && item.overflow_right <= 1),
    });
    if (item.id.startsWith("breadcrumb-"))
      checks.push({
        id: item.id + "-single-line",
        passed: item.visible && item.line_count === 1,
      });
    if (["price-prefix", "price-suffix", "price-code"].includes(item.id))
      checks.push({
        id: item.id + "-fully-readable",
        passed:
          item.visible &&
          item.line_count === 1 &&
          item.visible_width + 1 >= item.text_width,
      });
    if (item.id === "price-input") {
      checks.push({
        id: "price-input-usable-width",
        passed: item.visible && item.content_width > 30,
      });
      checks.push({
        id: "price-input-full-value-width",
        passed: item.visible && item.content_width + 1 >= item.text_width,
      });
    }
  }
  const entry = {
    schema: "aster-responsive-boundaries-v1",
    mode: "diagnostic",
    surface,
    fixture,
    locale,
    viewport: page.viewportSize(),
    document: documentSize,
    passed: checks.every((check) => check.passed),
    checks,
    measurements: measured,
  };
  console.log("BOUNDARY_PROBE_JSON " + JSON.stringify(entry));
}

export async function probeLoginBoundaries(page, screenshot) {
  const viewport = page.viewportSize();
  const locale = await page
    .locator(".preference-controls select")
    .first()
    .inputValue();
  try {
    for (const language of locales) {
      await selectLocale(page, language);
      for (const [name, fixture] of Object.entries(fixtures)) {
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          try {
            await installFixture(page, "login", fixture);
            await record(
              page,
              "login",
              name,
              language,
              await measurements(page, targets(loginTargets)),
            );
            // One representative screenshot per fixture/language; all six
            // widths retain geometry. Desktop also exposes the story/footnote.
            if (width === (language === "en" ? 721 : 320))
              await screenshot(name, language);
          } finally {
            await restoreFixture(page);
          }
        }
      }
    }
  } finally {
    await restoreFixture(page);
    await page.setViewportSize(viewport);
    await selectLocale(page, locale);
  }
}

export async function probeFinancialBoundaries(page, screenshot) {
  const viewport = page.viewportSize();
  const locale = await page
    .locator(".preference-controls select")
    .first()
    .inputValue();
  const trigger = page.locator(".mobile-menu");
  try {
    for (const language of locales) {
      await selectLocale(page, language);
      for (const [name, fixture] of Object.entries(fixtures)) {
        for (const width of widths) {
          await page.setViewportSize({ width, height: 900 });
          await settle(page);
          try {
            await installFixture(page, "financial", fixture);
            if (width <= 720) {
              await trigger.click();
              await settle(page);
            }
            const sidebar = await measurements(page, targets(sidebarTargets));
            if (width <= 720) {
              await page.keyboard.press("Escape");
              await settle(page);
            }
            await record(page, "financial", name, language, [
              ...sidebar,
              ...(await measurements(page, targets(priceTargets))),
            ]);
            if (width === (language === "en" ? 721 : 320))
              await screenshot(name, language);
          } finally {
            if ((await trigger.getAttribute("aria-expanded")) === "true") {
              await page.keyboard.press("Escape");
              await settle(page);
            }
            await restoreFixture(page);
          }
        }
      }
      await page.setViewportSize({ width: 721, height: 900 });
      await settle(page);
      await record(
        page,
        "breadcrumb",
        "default",
        language,
        await measurements(page, targets(breadcrumbTargets)),
      );
      await screenshot("breadcrumb", language);
    }
  } finally {
    if ((await trigger.getAttribute("aria-expanded")) === "true")
      await page.keyboard.press("Escape");
    await restoreFixture(page);
    await page.setViewportSize(viewport);
    await selectLocale(page, locale);
  }
}
